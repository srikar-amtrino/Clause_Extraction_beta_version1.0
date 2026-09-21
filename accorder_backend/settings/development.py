"""Local development settings."""
import os
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

if DATABASE_URL:
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
    # No DATABASE_URL configured: fall back to SQLite so the Drive connector's
    # sessions and the parsing tests still run without Neon access.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        },
    }
