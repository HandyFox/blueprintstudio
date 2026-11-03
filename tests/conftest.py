import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


@pytest.fixture()
def make_app(tmp_path, monkeypatch):
    def _make(**env):
        monkeypatch.setenv("BLUEPRINT_STUDIO_DATA_DIR", str(tmp_path / "data"))
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        from app import create_app
        app = create_app()
        app.config["TESTING"] = True
        return app
    return _make


@pytest.fixture()
def client(make_app):
    return make_app().test_client()


def login(c, user="admin", pw="1234"):
    r = c.post("/api/login", json={"username": user, "password": pw})
    assert r.status_code == 200, r.json
    return r
