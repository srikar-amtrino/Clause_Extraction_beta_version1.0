"""Local development settings."""
import logging
import os
import sys
from urllib.parse import parse_qsl, urlparse

from .base import *  # noqa: F401,F403
from .base import BASE_DIR
from .base import SECRET_KEY as _SECRET_KEY
from .base import env_bool, env_int

DEBUG = env_bool("DJANGO_DEBUG", True)

SECRET_KEY = _SECRET_KEY or "development-only-insecure-key"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

# Neon Postgres. The URL carries a password, so it is read from the
# environment and never committed. See DATABASE_URL in .env.example.
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# When running the Django test runner, use a local SQLite DB so we never need
# CREATE DATABASE permission on Neon (not granted on free-tier branches).
_running_tests = "test" in sys.argv


def _psycopg_pool_available():
    try:
        import psycopg_pool  # noqa: F401
    except ImportError:
        return False
    return True


if DATABASE_URL and not _running_tests:
    _db = urlparse(DATABASE_URL)
    _options = dict(parse_qsl(_db.query))
    # Reuse connections instead of opening one per request. A new Neon
    # connection is a TLS handshake plus SCRAM auth: ~1.9 s measured on 2026-10-06,
    # against ~0.27 s for a query. Under daphne (ASGI) CONN_MAX_AGE does
    # not carry a connection from one request to the next, so this is Django's
    # own psycopg pool. min_size 0 lets an idle pool drain (max_idle seconds per
    # connection), so it never holds Neon's compute awake overnight.
    if env_bool("DATABASE_POOL", True):
        if _psycopg_pool_available():
            _options["pool"] = {
                "min_size": env_int("DATABASE_POOL_MIN_SIZE", 0),
                "max_size": env_int("DATABASE_POOL_MAX_SIZE", 10),
                "max_idle": env_int("DATABASE_POOL_MAX_IDLE", 600),
                # Seconds a request waits for a free connection before failing.
                "timeout": env_int("DATABASE_POOL_TIMEOUT", 30),
            }
        else:
            logging.getLogger(__name__).warning(
                "psycopg_pool is not installed; every request opens its own "
                "database connection. Install requirements.txt to fix this.")
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db.path.lstrip("/"),
            "USER": _db.username,
            "PASSWORD": _db.password,
            "HOST": _db.hostname,
            "PORT": _db.port or 5432,
            "OPTIONS": _options,
            # Checks a pooled connection before handing it out. Neon closes
            # every connection when its compute suspends; without this the
            # first request after an idle spell fails on a dead socket.
            "CONN_HEALTH_CHECKS": True,
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
