"""Local development settings."""
import os
import sys
from urllib.parse import parse_qsl, urlparse

from .base import *  # noqa: F401,F403
from .base import BASE_DIR
from .base import SECRET_KEY as _SECRET_KEY
from .base import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)

SECRET_KEY = _SECRET_KEY or "development-only-insecure-key"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

# Neon Postgres. The URL carries a password, so it is read from the
# environment and never committed. See DATABASE_URL in .env.example.
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# When running the Django test runner, use a local SQLite DB so we never need
# CREATE DATABASE permission on Neon (not granted on free-tier branches).
_running_tests = "test" in sys.argv

if DATABASE_URL and not _running_tests:
    _db = urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db.path.lstrip("/"),
            "USER": _db.username,
            "PASSWORD": _db.password,
            "HOST": _db.hostname,
            "PORT": _db.port or 5432,
            "OPTIONS": dict(parse_qsl(_db.query)),
        }
    }
else:
    # No DATABASE_URL, or running tests: use SQLite so tests run offline
    # without touching Neon.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        },
    }
