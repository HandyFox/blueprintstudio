"""WSGI entry point.

    gunicorn wsgi:app            # production (see gunicorn.conf.py)
    python wsgi.py               # local development on http://127.0.0.1:5000

PythonAnywhere: point the web app's WSGI file at this module's `application`.
"""
import os
import sys

project_home = os.path.dirname(os.path.abspath(__file__))
if project_home not in sys.path:
    sys.path.insert(0, project_home)

from app import create_app  # noqa: E402

application = create_app()
app = application

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    application.run(host="127.0.0.1", port=port, debug=bool(os.environ.get("FLASK_DEBUG")))
