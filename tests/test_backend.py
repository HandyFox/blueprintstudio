"""Server tests: sign-in gate, accounts, shared storage and edit locks."""
from conftest import login


def test_editor_requires_login(client):
    r = client.get("/")
    assert r.status_code == 302 and r.headers["Location"].endswith("/login")
    assert client.get("/login").status_code == 200
    assert client.post("/api/export-pdf", json={"project": {}}).status_code == 401
    login(client)
    r = client.get("/")
    assert r.status_code == 200 and b'id="canvas"' in r.data
    assert b'id="fixture-data"' in r.data          # library inlined for the browser
    assert client.get("/login").status_code == 302  # already signed in


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json["ok"] is True


def test_seed_admin_and_password_change(client):
    assert client.post("/api/login", json={"username": "admin", "password": "nope"}).status_code == 401
    login(client, "ADMIN")  # case-insensitive
    assert client.get("/api/me").json["user"] == {"username": "admin", "is_admin": True}
    r = client.post("/api/account/password", json={"current": "1234", "new": "abcd1234"})
    assert r.status_code == 200
    assert client.post("/api/login", json={"username": "admin", "password": "1234"}).status_code == 401
    login(client, "admin", "abcd1234")


def test_seed_admin_from_env(make_app):
    c = make_app(BLUEPRINT_STUDIO_ADMIN_USER="boss", BLUEPRINT_STUDIO_ADMIN_PASSWORD="s3cret!").test_client()
    login(c, "boss", "s3cret!")


def test_admin_user_management(make_app):
    app = make_app()
    admin, penny = app.test_client(), app.test_client()
    login(admin)
    assert admin.post("/api/admin/users", json={"username": "Penny", "password": "bazinga"}).status_code == 200
    assert admin.post("/api/admin/users", json={"username": "Penny", "password": "x1234"}).status_code == 400
    login(penny, "Penny", "bazinga")
    assert penny.get("/api/admin/users").status_code == 403
    assert admin.post("/api/admin/users/Penny/password", json={"new": "newpw1"}).status_code == 200
    login(penny, "Penny", "newpw1")
    assert admin.delete("/api/admin/users/admin").status_code == 400          # last admin
    assert admin.post("/api/admin/users/admin/admin", json={"is_admin": False}).status_code == 400
    assert admin.delete("/api/admin/users/Penny").status_code == 200


def test_accounts_shared_between_processes(make_app, tmp_path):
    """Two app instances (≈ two gunicorn workers) see each other's changes."""
    a1 = make_app()
    from app import create_app
    a2 = create_app()
    c1, c2 = a1.test_client(), a2.test_client()
    login(c1)
    assert c1.post("/api/admin/users", json={"username": "Leonard", "password": "physics"}).status_code == 200
    login(c2, "Leonard", "physics")


def test_storage_and_locks(make_app):
    app = make_app()
    admin, penny = app.test_client(), app.test_client()
    login(admin)
    admin.post("/api/admin/users", json={"username": "Penny", "password": "bazinga"})
    login(penny, "Penny", "bazinga")
    proj = {"version": 1, "items": []}

    assert admin.post("/api/projects/team/house.bpsj", json={"project": proj}).status_code == 200
    listing = penny.get("/api/projects").json
    assert [f["filename"] for f in listing["team"]] == ["house.bpsj"]
    assert listing["team"][0]["locked_by"] == "admin"
    assert penny.get("/api/projects/team/house.bpsj").status_code == 200       # read-only open is fine

    r = penny.post("/api/projects/team/house.bpsj", json={"project": proj})
    assert r.status_code == 409 and r.json["locked_by"] == "admin"
    assert penny.post("/api/projects/team/house.bpsj/steal").status_code == 200
    hb = admin.post("/api/projects/team/house.bpsj/heartbeat").json
    assert hb["ok"] is False and hb["owner"] == "Penny"
    assert penny.post("/api/projects/team/house.bpsj", json={"project": proj}).status_code == 200

    # personal folders are private
    assert admin.post("/api/projects/me/mine.bpsj", json={"project": proj}).status_code == 200
    assert penny.get("/api/projects/admin/mine.bpsj").status_code in (400, 404)
    # path traversal
    assert penny.get("/api/projects/me/..%2F..%2Faccounts.json").status_code in (400, 404)


def test_logout(client):
    login(client)
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/me").json["user"] is None


def test_subpath_prefix_env(make_app):
    c = make_app(BLUEPRINT_STUDIO_PREFIX="/blueprints").test_client()
    assert c.get("/api/health").status_code == 404
    assert c.get("/blueprints/api/health").status_code == 200
    r = c.post("/blueprints/api/login", json={"username": "admin", "password": "1234"})
    assert r.status_code == 200
    assert "Path=/blueprints/" in r.headers["Set-Cookie"]
    page = c.get("/blueprints/")
    assert page.status_code == 200
    assert b'<base href="/blueprints/">' in page.data
    assert b"/blueprints/static/css/app.css" in page.data


def test_forwarded_prefix_header(client):
    h = {"X-Forwarded-Prefix": "/plans", "X-Forwarded-Proto": "https"}
    r = client.post("/api/login", json={"username": "admin", "password": "1234"}, headers=h)
    cookie = r.headers["Set-Cookie"]
    assert "Path=/plans/" in cookie and "Secure" in cookie
    # nginx strips /plans before proxying, so the browser's cookie (scoped to
    # /plans/) arrives on a request for "/": send it explicitly here.
    name, value = cookie.split(";")[0].split("=", 1)
    client.set_cookie(name, value, path="/")
    page = client.get("/", headers=h)
    assert page.status_code == 200
    assert b'<base href="/plans/">' in page.data
    assert b"/plans/static/js/app.js" in page.data
