"""
Multi-user shared-storage backend for Blueprint Studio.

Design choices made for PythonAnywhere-friendliness (no DB, no extra deps):

* Accounts live in a single JSON file (`accounts.json`) at the project root.
* Passwords stored as PBKDF2-SHA256 with per-user random salt — `hashlib`
  only, no third-party crypto libs.
* Sessions are HMAC-signed cookies — server-side state is just `accounts.json`.
* Projects live as plain `.bpsj` files under `projects/<scope>/`, where
  `<scope>` is either a username (for personal folder) or the literal
  string `"Team"` (the shared folder).
* Lock files: `<file>.lock` next to each `.bpsj` containing the editor's
  username + timestamp. Locks expire after `LOCK_TIMEOUT_SEC` of no
  heartbeat, so a closed tab doesn't strand a file forever.

The whole module exposes:
    Storage      — wraps the projects/ tree
    Accounts     — wraps accounts.json (load, save, hash, verify)
    sign_token / verify_token  — cookie token helpers
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
from contextlib import contextmanager

try:  # POSIX file locking so several server processes can share accounts.json
    import fcntl
except ImportError:  # pragma: no cover - Windows dev boxes
    fcntl = None
import time
from typing import Any

# How long a lock survives without a heartbeat. Tabs heartbeat every minute.
LOCK_TIMEOUT_SEC = 5 * 60

TEAM_FOLDER = "Team"

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_\-]{2,32}$")
_FILENAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,80}$")


def _atomic_json(path: str, data, indent=None) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=d)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent)
    os.replace(tmp, path)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


# --- Password hashing -----------------------------------------------------

def hash_password(password: str, salt: bytes | None = None,
                  iterations: int = 200_000) -> str:
    """Return 'pbkdf2_sha256$<iter>$<salt_b64>$<hash_b64>'."""
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations)
    return (
        f"pbkdf2_sha256${iterations}$"
        f"{base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iters))
        return hmac.compare_digest(expected, actual)
    except Exception:
        return False


# --- Accounts -------------------------------------------------------------

class Accounts:
    """Backed by a JSON file. Format:
        {
          "users": {
            "admin": {
              "password": "pbkdf2_sha256$...",
              "is_admin": true,
              "created_at": 1714685000
            },
            ...
          },
          "secret": "<hex>"   # used to sign session cookies
        }
    """

    def __init__(self, path: str, seed_user: str | None = None,
                 seed_password: str | None = None):
        self.path = path
        self.data: dict[str, Any] = {"users": {}, "secret": ""}
        self._mtime = 0.0
        self._lock = threading.RLock()
        self._seed_user = seed_user or os.environ.get("BLUEPRINT_STUDIO_ADMIN_USER") or "admin"
        self._seed_password = (seed_password or os.environ.get("BLUEPRINT_STUDIO_ADMIN_PASSWORD")
                               or "1234")
        with self._file_lock():
            self.load_or_init()

    @contextmanager
    def _file_lock(self):
        """Serialise changes across threads AND processes (gunicorn workers)."""
        with self._lock:
            if fcntl is None:
                yield
                return
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            with open(self.path + ".lock", "a+") as lf:
                fcntl.flock(lf, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lf, fcntl.LOCK_UN)

    def load_or_init(self) -> None:
        if os.path.exists(self.path):
            self._read()
        else:
            self.data = {"users": {}, "secret": secrets.token_hex(32)}
            # Seed the first administrator.
            self.data["users"][self._seed_user] = {
                "password": hash_password(self._seed_password),
                "is_admin": True,
                "created_at": int(time.time()),
            }
            self.save()
        self.data.setdefault("users", {})
        if not self.data.get("secret"):
            self.data["secret"] = secrets.token_hex(32)
            self.save()

    def _read(self) -> None:
        with open(self.path, "r", encoding="utf-8") as f:
            self.data = json.load(f)
        self.data.setdefault("users", {})
        self._mtime = os.path.getmtime(self.path)

    def _sync(self) -> None:
        """Pick up changes another server process made to accounts.json."""
        try:
            m = os.path.getmtime(self.path)
        except OSError:
            return
        if m != self._mtime:
            with self._lock:
                try:
                    self._read()
                except (OSError, ValueError):
                    pass

    def save(self) -> None:
        d = os.path.dirname(self.path) or "."
        fd, tmp = tempfile.mkstemp(prefix=".accounts-", suffix=".tmp", dir=d)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2)
        os.replace(tmp, self.path)
        self._mtime = os.path.getmtime(self.path)

    @contextmanager
    def _mutate(self):
        with self._file_lock():
            if os.path.exists(self.path):
                self._read()
            yield
            self.save()

    @property
    def secret(self) -> str:
        return self.data["secret"]

    def get(self, username: str) -> dict | None:
        self._sync()
        # Case-sensitive lookup, but we let the seeded "admin" be found
        # even if the user types it with different casing.
        if username in self.data["users"]:
            return self.data["users"][username]
        for u in self.data["users"]:
            if u.lower() == username.lower():
                return self.data["users"][u]
        return None

    def canonical_name(self, username: str) -> str | None:
        self._sync()
        if username in self.data["users"]:
            return username
        for u in self.data["users"]:
            if u.lower() == username.lower():
                return u
        return None

    def authenticate(self, username: str, password: str) -> str | None:
        """Return the canonical username on success, None on failure."""
        u = self.canonical_name(username)
        if u is None:
            return None
        rec = self.data["users"][u]
        if verify_password(password, rec["password"]):
            return u
        return None

    def is_admin(self, username: str) -> bool:
        rec = self.get(username)
        return bool(rec and rec.get("is_admin"))

    def list_users(self) -> list[dict]:
        self._sync()
        return [
            {"username": u,
             "is_admin": rec.get("is_admin", False),
             "created_at": rec.get("created_at")}
            for u, rec in sorted(self.data["users"].items())
        ]

    def create_user(self, username: str, password: str,
                    is_admin: bool = False) -> None:
        if not _USERNAME_RE.fullmatch(username):
            raise ValueError("Invalid username (use 2-32 letters, digits, _, -)")
        if self.get(username) is not None:
            raise ValueError("Username already exists")
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters")
        with self._mutate():
            if self.get(username) is not None:
                raise ValueError("Username already exists")
            self.data["users"][username] = {
                "password": hash_password(password),
                "is_admin": bool(is_admin),
                "created_at": int(time.time()),
            }

    def delete_user(self, username: str) -> None:
        u = self.canonical_name(username)
        if u is None:
            raise ValueError("No such user")
        # Refuse to delete the last admin
        with self._mutate():
            if self.data["users"][u].get("is_admin"):
                admins = [n for n, r in self.data["users"].items() if r.get("is_admin")]
                if len(admins) <= 1:
                    raise ValueError("Cannot delete the last admin")
            del self.data["users"][u]

    def set_password(self, username: str, new_password: str) -> None:
        u = self.canonical_name(username)
        if u is None:
            raise ValueError("No such user")
        if len(new_password) < 4:
            raise ValueError("Password must be at least 4 characters")
        with self._mutate():
            self.data["users"][u]["password"] = hash_password(new_password)

    def set_admin(self, username: str, is_admin: bool) -> None:
        u = self.canonical_name(username)
        if u is None:
            raise ValueError("No such user")
        # Don't allow demoting last admin
        with self._mutate():
            if not is_admin and self.data["users"][u].get("is_admin"):
                admins = [n for n, r in self.data["users"].items() if r.get("is_admin")]
                if len(admins) <= 1:
                    raise ValueError("Cannot remove admin from the last admin")
            self.data["users"][u]["is_admin"] = bool(is_admin)


# --- Session tokens (signed cookies) --------------------------------------

def sign_token(secret: str, username: str, ttl_sec: int = 30 * 24 * 3600) -> str:
    payload = {"u": username, "exp": int(time.time()) + ttl_sec}
    body = base64.urlsafe_b64encode(
        json.dumps(payload).encode("utf-8")).rstrip(b"=").decode("ascii")
    sig = hmac.new(secret.encode("utf-8"), body.encode("ascii"),
                   hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def verify_token(secret: str, token: str) -> str | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    expected = hmac.new(secret.encode("utf-8"), body.encode("ascii"),
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        # Re-pad for b64
        pad = "=" * (-len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(body + pad))
    except Exception:
        return None
    if payload.get("exp", 0) < int(time.time()):
        return None
    return payload.get("u")


# --- Project storage ------------------------------------------------------

class StorageError(Exception):
    pass


class Storage:
    """File-backed project storage with per-user folders + Team folder."""

    def __init__(self, root: str):
        self.root = root
        _ensure_dir(self.root)
        _ensure_dir(os.path.join(self.root, TEAM_FOLDER))

    @staticmethod
    def validate_filename(name: str) -> str:
        """Returns a safe filename ending in .bpsj, or raises."""
        if not name:
            raise StorageError("Filename required")
        # Strip any path separators paranoia
        if "/" in name or "\\" in name or ".." in name:
            raise StorageError("Invalid filename")
        if not name.lower().endswith(".bpsj"):
            name = name + ".bpsj"
        base = name[:-5]
        if not _FILENAME_RE.fullmatch(base):
            raise StorageError(
                "Filename may use letters, digits, spaces, '_', '-', '.'")
        return name

    def scope_path(self, scope: str, username: str) -> str:
        """Return the absolute folder path for a scope.

        scope == 'Team'    -> projects/Team
        scope == username  -> projects/<username>
        scope == 'me'      -> shorthand for the caller's own folder
        Anything else for a non-admin -> denied.
        """
        if scope == "me":
            scope = username
        if scope == TEAM_FOLDER:
            d = os.path.join(self.root, TEAM_FOLDER)
        elif scope == username:
            d = os.path.join(self.root, username)
        else:
            # Allow the user's own folder under their canonical name only
            raise StorageError("Access denied")
        _ensure_dir(d)
        return d

    def file_path(self, scope: str, filename: str, username: str) -> str:
        filename = self.validate_filename(filename)
        return os.path.join(self.scope_path(scope, username), filename)

    def list_projects(self, username: str) -> dict[str, list[dict]]:
        """Return {'mine': [...], 'team': [...]}.

        Each entry: {filename, modified_ts, locked_by, locked_fresh}.
        """
        out = {"mine": [], "team": []}
        for label, scope in (("mine", username), ("team", TEAM_FOLDER)):
            d = self.scope_path(scope, username)
            try:
                names = os.listdir(d)
            except FileNotFoundError:
                continue
            for n in sorted(names):
                if not n.lower().endswith(".bpsj"):
                    continue
                full = os.path.join(d, n)
                lock = self.read_lock(scope, n, username)
                out[label].append({
                    "filename": n,
                    "modified_ts": int(os.path.getmtime(full)),
                    "size": os.path.getsize(full),
                    "locked_by": lock["owner"] if lock else None,
                    "locked_fresh": bool(lock and lock["fresh"]),
                })
        return out

    def read_project(self, scope: str, filename: str, username: str) -> dict:
        path = self.file_path(scope, filename, username)
        if not os.path.exists(path):
            raise StorageError("File not found")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def write_project(self, scope: str, filename: str,
                      project: dict, username: str) -> None:
        path = self.file_path(scope, filename, username)
        _atomic_json(path, project, indent=1)

    def delete_project(self, scope: str, filename: str, username: str) -> None:
        path = self.file_path(scope, filename, username)
        if os.path.exists(path):
            os.remove(path)
        # Also clean up its lock
        lock_path = path + ".lock"
        if os.path.exists(lock_path):
            os.remove(lock_path)

    def rename_project(self, scope: str, old: str, new: str,
                       username: str) -> None:
        old_path = self.file_path(scope, old, username)
        new_path = self.file_path(scope, new, username)
        if not os.path.exists(old_path):
            raise StorageError("Source not found")
        if os.path.exists(new_path):
            raise StorageError("Target already exists")
        os.rename(old_path, new_path)
        # Move lock too if any
        if os.path.exists(old_path + ".lock"):
            os.rename(old_path + ".lock", new_path + ".lock")

    # ---- Locks ----------------------------------------------------------

    def _lock_path(self, scope: str, filename: str, username: str) -> str:
        return self.file_path(scope, filename, username) + ".lock"

    def read_lock(self, scope: str, filename: str, username: str) -> dict | None:
        """Return None if no lock, else {owner, ts, fresh: bool}."""
        path = self._lock_path(scope, filename, username)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            return None
        ts = int(d.get("ts", 0))
        owner = d.get("owner") or "?"
        fresh = (time.time() - ts) < LOCK_TIMEOUT_SEC
        return {"owner": owner, "ts": ts, "fresh": fresh}

    def acquire_lock(self, scope: str, filename: str, username: str,
                     force: bool = False) -> dict:
        """Try to grab the lock. Returns {ok, owner, fresh}.

        - If no lock exists, take it.
        - If we already own the lock (or it's stale), refresh it.
        - If someone else has a fresh lock and force=False, refuse.
        - If force=True, overwrite anyway.
        """
        existing = self.read_lock(scope, filename, username)
        if (existing and existing["fresh"] and existing["owner"] != username
                and not force):
            return {"ok": False, "owner": existing["owner"],
                    "fresh": True}
        path = self._lock_path(scope, filename, username)
        _atomic_json(path, {"owner": username, "ts": int(time.time())})
        return {"ok": True, "owner": username, "fresh": True}

    def heartbeat_lock(self, scope: str, filename: str, username: str) -> dict:
        existing = self.read_lock(scope, filename, username)
        if existing and existing["owner"] != username and existing["fresh"]:
            return {"ok": False, "owner": existing["owner"]}
        # Refresh / create
        path = self._lock_path(scope, filename, username)
        _atomic_json(path, {"owner": username, "ts": int(time.time())})
        return {"ok": True, "owner": username}

    def release_lock(self, scope: str, filename: str, username: str) -> None:
        existing = self.read_lock(scope, filename, username)
        if existing and existing["owner"] == username:
            path = self._lock_path(scope, filename, username)
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
