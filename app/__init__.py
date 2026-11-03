"""Flask app factory.

The browser app is mostly self-contained — geometry, snap, undo, rendering,
and saving all happen client-side. The server is here for:

1. Serving the static page and JS/CSS bundles.
2. Generating PDF exports server-side via ReportLab.
3. Multi-user shared storage: per-user folders + a Team folder, with
   accounts, login, and file locks for collaboration.

Local files (the user's hard drive) and shared files (server-side) coexist —
the existing local download/upload still works, and the shared-folder UI
appears once the user signs in.
"""
from __future__ import annotations

import os
import time

from flask import (Flask, jsonify, make_response, redirect, render_template,
                   request, send_file)
from werkzeug.middleware.proxy_fix import ProxyFix

__version__ = "2.0.0"


class PrefixMiddleware:
    """Serve the app under a URL prefix (e.g. /blueprints) without the
    reverse proxy having to strip it. Set BLUEPRINT_STUDIO_PREFIX=/blueprints.
    Requests outside the prefix get a 404."""

    def __init__(self, wsgi_app, prefix: str):
        self.app = wsgi_app
        self.prefix = "/" + prefix.strip("/")

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        if path == self.prefix or path.startswith(self.prefix + "/"):
            environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + self.prefix
            environ["PATH_INFO"] = path[len(self.prefix):] or "/"
            return self.app(environ, start_response)
        start_response("404 Not Found", [("Content-Type", "text/plain")])
        return [b"Not found"]


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB

    # Behind nginx/Caddy/Traefik: trust X-Forwarded-* from N proxy hops so
    # https, the client IP and an X-Forwarded-Prefix mount point are honoured.
    hops = int(os.environ.get("BLUEPRINT_STUDIO_PROXY_HOPS", "1") or 0)
    if hops > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops,
                                x_host=hops, x_prefix=hops)
    prefix = (os.environ.get("BLUEPRINT_STUDIO_PREFIX") or "").strip()
    if prefix and prefix != "/":
        app.wsgi_app = PrefixMiddleware(app.wsgi_app, prefix)

    import json as _json
    fixtures_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "static", "data", "fixtures.json")
    with open(fixtures_path, "r", encoding="utf-8") as f:
        fixtures_json = _json.dumps(_json.load(f), separators=(",", ":"))
    fixtures_json = fixtures_json.replace("</", "<\\/")

    # Project root for storage. Defaults to <project>/data/, but operators
    # can override on PythonAnywhere by setting BLUEPRINT_STUDIO_DATA_DIR.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.environ.get(
        "BLUEPRINT_STUDIO_DATA_DIR",
        os.path.join(project_root, "data"))
    os.makedirs(data_dir, exist_ok=True)

    accounts_path = os.path.join(data_dir, "accounts.json")
    projects_root = os.path.join(data_dir, "projects")

    from app.lib.auth_storage import (Accounts, Storage, StorageError,
                                      sign_token, verify_token)

    accounts = Accounts(accounts_path)
    asset_version = __version__ + "-" + str(int(time.time()))
    storage = Storage(projects_root)

    SESSION_COOKIE = "bps_session"

    def current_user() -> str | None:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None
        u = verify_token(accounts.secret, token)
        if u is None:
            return None
        if accounts.get(u) is None:
            return None
        return accounts.canonical_name(u)

    def require_user():
        u = current_user()
        if u is None:
            return None, (jsonify({"error": "Not logged in"}), 401)
        return u, None

    def require_admin():
        u, err = require_user()
        if err:
            return None, err
        if not accounts.is_admin(u):
            return None, (jsonify({"error": "Admin access required"}), 403)
        return u, None

    def make_session_response(payload, username):
        resp = make_response(jsonify(payload))
        token = sign_token(accounts.secret, username)
        resp.set_cookie(
            SESSION_COOKIE, token,
            max_age=30 * 24 * 3600,
            httponly=True, samesite="Lax",
            secure=request.is_secure,
            path=cookie_path(),
        )
        return resp

    def cookie_path() -> str:
        return (request.script_root or "") + "/"

    def page(template: str):
        return render_template(template, base_path=cookie_path(),
                               asset_version=asset_version,
                               fixtures_json=fixtures_json)

    def _validate_scope(scope: str, username: str) -> str | None:
        if scope == "team":
            return "Team"
        if scope == "me":
            return username
        if scope == username:
            return username
        return None

    # ---- Page + health --------------------------------------------------

    @app.route("/")
    def index():
        # Require login for ALL access to the editor. Anyone hitting / who
        # isn't signed in gets bounced to /login. The editor page itself
        # then knows the user is authenticated and skips the login dialog.
        if current_user() is None:
            return redirect(cookie_path() + "login")
        resp = make_response(page("index.html"))
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.route("/login")
    def login_page():
        if current_user() is not None:
            return redirect(cookie_path())
        return page("login.html")

    @app.route("/api/health")
    def health():
        return jsonify({"ok": True, "service": "blueprint-studio", "version": __version__})

    # ---- PDF export (login required) -----------------------------------

    @app.route("/api/export-pdf", methods=["POST"])
    def export_pdf():
        _, err = require_user()
        if err:
            return err
        try:
            payload = request.get_json(force=True, silent=False)
        except Exception:
            return jsonify({"error": "invalid JSON"}), 400

        project = payload.get("project") or {}
        page_size = payload.get("page_size", "Letter")
        landscape = bool(payload.get("landscape", True))
        margins_in = float(payload.get("margins_in", 0.25))
        fit_to_page = bool(payload.get("fit_to_page", False))
        elevations = payload.get("elevations") or []
        cabinet_list = payload.get("cabinet_list")
        if cabinet_list is None:   # older clients: list cabinets if any
            cabinet_list = {"include": True, "prices": True}

        from app.lib.pdf_export import build_pdf
        try:
            buf = build_pdf(project, page_size=page_size,
                            landscape=landscape, margins_in=margins_in,
                            fit_to_page=fit_to_page, elevations=elevations,
                            cabinet_list=cabinet_list)
        except Exception as e:  # pragma: no cover - surfaced to the user
            app.logger.exception("PDF export failed")
            return jsonify({"error": f"PDF failed: {e}"}), 500

        buf.seek(0)
        title = (project.get("settings") or {}).get(
            "drawing_title") or "blueprint"
        safe = "".join(c for c in title if c.isalnum() or c in "-_ ").strip()
        filename = (safe or "blueprint") + ".pdf"
        return send_file(buf, mimetype="application/pdf",
                         as_attachment=True, download_name=filename)

    # ---- Auth -----------------------------------------------------------

    @app.route("/api/login", methods=["POST"])
    def login():
        body = request.get_json(silent=True) or {}
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if not username or not password:
            return jsonify({"error": "Username and password required"}), 400
        canonical = accounts.authenticate(username, password)
        if not canonical:
            return jsonify({"error": "Invalid username or password"}), 401
        storage.scope_path(canonical, canonical)  # ensure folder exists
        return make_session_response(
            {"ok": True, "user": {
                "username": canonical,
                "is_admin": accounts.is_admin(canonical),
            }}, canonical)

    @app.route("/api/logout", methods=["POST"])
    def logout():
        resp = make_response(jsonify({"ok": True}))
        resp.delete_cookie(SESSION_COOKIE, path=cookie_path())
        resp.delete_cookie(SESSION_COOKIE)  # cookies from older versions
        return resp

    @app.route("/api/me")
    def me():
        u = current_user()
        if u is None:
            return jsonify({"user": None})
        return jsonify({"user": {
            "username": u,
            "is_admin": accounts.is_admin(u),
        }})

    @app.route("/api/account/password", methods=["POST"])
    def change_password():
        u, err = require_user()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        current = body.get("current") or ""
        new = body.get("new") or ""
        if not accounts.authenticate(u, current):
            return jsonify({"error": "Current password is wrong"}), 400
        try:
            accounts.set_password(u, new)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    # ---- Admin ----------------------------------------------------------

    @app.route("/api/admin/users", methods=["GET"])
    def admin_list_users():
        _, err = require_admin()
        if err:
            return err
        return jsonify({"users": accounts.list_users()})

    @app.route("/api/admin/users", methods=["POST"])
    def admin_create_user():
        _, err = require_admin()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        is_admin = bool(body.get("is_admin"))
        try:
            accounts.create_user(username, password, is_admin)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        storage.scope_path(username, username)
        return jsonify({"ok": True})

    @app.route("/api/admin/users/<username>", methods=["DELETE"])
    def admin_delete_user(username):
        u, err = require_admin()
        if err:
            return err
        if accounts.canonical_name(username) == u:
            return jsonify({"error": "Can't delete your own account"}), 400
        try:
            accounts.delete_user(username)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    @app.route("/api/admin/users/<username>/password", methods=["POST"])
    def admin_set_password(username):
        _, err = require_admin()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        new = body.get("new") or ""
        try:
            accounts.set_password(username, new)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    @app.route("/api/admin/users/<username>/admin", methods=["POST"])
    def admin_set_admin(username):
        _, err = require_admin()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        is_admin = bool(body.get("is_admin"))
        try:
            accounts.set_admin(username, is_admin)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    # ---- Projects -------------------------------------------------------

    @app.route("/api/projects", methods=["GET"])
    def list_projects():
        u, err = require_user()
        if err:
            return err
        return jsonify(storage.list_projects(u))

    @app.route("/api/projects/<scope>/<path:filename>", methods=["GET"])
    def get_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        try:
            project = storage.read_project(s, filename, u)
            lock_status = storage.read_lock(s, filename, u)
        except StorageError as e:
            return jsonify({"error": str(e)}), 404
        return jsonify({
            "project": project,
            "lock": lock_status,
        })

    @app.route("/api/projects/<scope>/<path:filename>", methods=["POST"])
    def save_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        body = request.get_json(silent=True) or {}
        project = body.get("project")
        if not isinstance(project, dict):
            return jsonify({"error": "Missing project"}), 400
        force = bool(body.get("force"))
        try:
            existing = storage.read_lock(s, filename, u)
            if (existing and existing["fresh"]
                    and existing["owner"] != u and not force):
                return jsonify({
                    "error": "File is locked by another user",
                    "locked_by": existing["owner"],
                }), 409
            storage.write_project(s, filename, project, u)
            storage.heartbeat_lock(s, filename, u)
        except StorageError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True, "modified_ts": int(time.time())})

    @app.route("/api/projects/<scope>/<path:filename>/heartbeat",
               methods=["POST"])
    def heartbeat_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        try:
            return jsonify(storage.heartbeat_lock(s, filename, u))
        except StorageError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/projects/<scope>/<path:filename>/release",
               methods=["POST"])
    def release_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        try:
            storage.release_lock(s, filename, u)
        except StorageError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    @app.route("/api/projects/<scope>/<path:filename>/steal",
               methods=["POST"])
    def steal_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        try:
            return jsonify(storage.acquire_lock(s, filename, u, force=True))
        except StorageError as e:
            return jsonify({"error": str(e)}), 400

    @app.route("/api/projects/<scope>/<path:filename>", methods=["DELETE"])
    def delete_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        try:
            existing = storage.read_lock(s, filename, u)
            if existing and existing["fresh"] and existing["owner"] != u:
                return jsonify({
                    "error": "File is locked by another user",
                    "locked_by": existing["owner"],
                }), 409
            storage.delete_project(s, filename, u)
        except StorageError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    @app.route("/api/projects/<scope>/<path:filename>/rename",
               methods=["POST"])
    def rename_project(scope, filename):
        u, err = require_user()
        if err:
            return err
        s = _validate_scope(scope, u)
        if s is None:
            return jsonify({"error": "Invalid scope"}), 400
        body = request.get_json(silent=True) or {}
        new = (body.get("new") or "").strip()
        try:
            storage.rename_project(s, filename, new, u)
        except StorageError as e:
            return jsonify({"error": str(e)}), 400
        return jsonify({"ok": True})

    return app
