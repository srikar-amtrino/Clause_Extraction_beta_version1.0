"""Settings shared by every environment. Values that differ per environment
or are secret come from the process environment, loaded from `.env`."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    value = os.environ.get(name)
    return int(value) if value not in (None, "") else default


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]

INSTALLED_APPS = [
    "document_pipeline",
]

MIDDLEWARE = []

ROOT_URLCONF = "accorder_backend.urls"

# Databases are configured with the data layer models (Phase 2, Step 2.3).
DATABASES = {}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}

# ---------------------------------------------------------------- Google Drive
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_OAUTH_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "")

# Development only: where `drive_authorize` stores the refresh token.
GOOGLE_DRIVE_TOKEN_PATH = Path(
    os.environ.get("GOOGLE_DRIVE_TOKEN_PATH", BASE_DIR / ".secrets" / "drive_token.json")
)

# ---------------------------------------------------------------- Parsing
# Files larger than this are refused before any bytes are downloaded.
PARSE_MAX_FILE_BYTES = env_int("PARSE_MAX_FILE_BYTES", 50 * 1024 * 1024)
