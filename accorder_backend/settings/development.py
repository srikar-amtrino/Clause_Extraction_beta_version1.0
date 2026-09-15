"""Local development settings."""
from .base import *  # noqa: F401,F403
from .base import SECRET_KEY as _SECRET_KEY
from .base import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)

SECRET_KEY = _SECRET_KEY or "development-only-insecure-key"

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
