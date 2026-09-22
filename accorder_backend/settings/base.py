"""Settings shared by every environment. Values that differ per environment
or are secret come from the process environment, loaded from `.env`."""
import os
import ssl
from urllib.parse import quote, urlparse
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOG_DIR = BASE_DIR / "logs"

load_dotenv(BASE_DIR / ".env")


def upstash_redis_url():
    rest_url = os.environ.get("UPSTASH_REDIS_REST_URL", "")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "")
    if not rest_url or not token:
        return ""

    hostname = urlparse(rest_url).hostname
    if not hostname:
        return ""
    return f"rediss://default:{quote(token, safe='')}@{hostname}:6379/0"


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name, default):
    value = os.environ.get(name)
    return int(value) if value not in (None, "") else default


def env_float(name, default):
    value = os.environ.get(name)
    return float(value) if value not in (None, "") else default


def env_list(name, default):
    value = os.environ.get(name)
    if value is None:
        return list(default)
    return [item.strip() for item in value.split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
DEBUG = env_bool("DJANGO_DEBUG", False)
ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]

INSTALLED_APPS = [
    # Sessions hold the signed-in user's Drive credentials for the ingestion
    # connector; auth depends on contenttypes.
    "django.contrib.sessions",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "core",
    "document_pipeline",
]

# NOTE: CsrfViewMiddleware is deliberately absent. The Drive picker page posts
# to /api/google-drive/sync/ without a CSRF token; adding the middleware breaks
# that flow. Add both together when the ingestion UI is hardened.
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
]

ROOT_URLCONF = "accorder_backend.urls"

# APP_DIRS finds document_pipeline/templates/google_drive/picker.html.
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

# Per-environment. Sessions need a real database; see development.py.
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
        "application_file": {
            "class": "logging.FileHandler",
            "filename": str(LOG_DIR / "application.log"),
            "formatter": "standard",
            "encoding": "utf-8",
        },
    },
    "root": {
        "handlers": ["console", "application_file"],
        "level": os.environ.get("LOG_LEVEL", "INFO"),
    },
    # The HTTP and AWS clients under the Bedrock SDK log every request at INFO.
    # Classification records each call itself, in classification_calls.
    "loggers": {
        "httpx2": {"level": "WARNING"},
        "botocore": {"level": "WARNING"},
    },
}

# ---------------------------------------------------------------- Google Drive
# OAuth client, picker and token configuration live with the ingestion
# connector (document_pipeline/connectors/GoogleDrive), which reads them from
# the environment directly. See .env.example.

# ---------------------------------------------------------------- Parsing
# Files larger than this are refused before any bytes are downloaded.
PARSE_MAX_FILE_BYTES = env_int("PARSE_MAX_FILE_BYTES", 50 * 1024 * 1024)

# ---------------------------------------------------------------- Persistence
# Keep the parser's verbatim output alongside the extracted rows. Insurance
# while the columns are still being trusted: it makes a column we got wrong
# recoverable without re-downloading a file that may since have changed.
PARSE_STORE_RAW_RESULT = env_bool("PARSE_STORE_RAW_RESULT", True)
# Bump when the parser changes behaviour without changing its output shape.
# SCHEMA_VERSION does not move for a bug fix, so this is what tells a stored
# extraction apart from what the current parser would produce. The code default
# moves with every such change; the environment only overrides it, and a blank
# value falls back to it rather than silently pinning an old build.
# 2026-09-18: list depth, shared Word list counters, heading nesting.
# 2026-09-18b: typed multi-letter Roman numerals (II., IV.) start clauses.
PARSER_BUILD = os.environ.get("PARSER_BUILD") or "2026.09.18b"
# Guards against Postgres's 65535 bind-parameter ceiling on huge documents.
PERSIST_BULK_BATCH_SIZE = env_int("PERSIST_BULK_BATCH_SIZE", 500)

# ---------------------------------------------------------------- Chunking
# Bump when the chunking rules change. Chunks derive deterministically from a
# clause tree, so this is the only thing that tells a stored chunk run apart
# from what the current chunker would produce for the same parse.
# As with PARSER_BUILD, the code default moves with each rule change and a blank
# environment value falls back to it.
# 2026-09-18: exhibit region from headings, not from sentences that cite one.
# At most 16 characters (chunk_runs.chunker_version); a system check enforces it.
CHUNKER_VERSION = os.environ.get("CHUNKER_VERSION") or "2026.09.18"
CHUNK_BULK_BATCH_SIZE = env_int("CHUNK_BULK_BATCH_SIZE", 500)

# ---------------------------------------------------------------- Pipeline
# Where export_documents writes each document's extraction.json and
# classification.json. Holds contract text: git-ignored.
PIPELINE_EXPORT_DIR = os.environ.get("PIPELINE_EXPORT_DIR") or str(BASE_DIR / "pipeline_output")

# ---------------------------------------------------------------- Classification
# Credentials are the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, read
# by the SDK straight from the environment; they are never copied into settings.
AWS_REGION = os.environ.get("AWS_REGION", "")
# "invoke" is Bedrock's InvokeModel API (AnthropicBedrock). "mantle" is the
# Messages API endpoint (AnthropicBedrockMantle): newer models need it, but it
# has no endpoint in every region -- us-west-1 has none.
BEDROCK_CLIENT = os.environ.get("BEDROCK_CLIENT", "invoke")
# A Bedrock model id or inference-profile ARN. No default on purpose: every
# classification records the model that produced it, so the choice is explicit.
CLASSIFY_MODEL_ID = os.environ.get("CLASSIFY_MODEL_ID", "")
# Which seeded taxonomy to classify against. Versions are immutable data.
CLASSIFY_TAXONOMY_VERSION = os.environ.get("CLASSIFY_TAXONOMY_VERSION", "v1")
# "" sends no thinking configuration; "adaptive" turns thinking on. On the
# 2026-09-18 probe adaptive thinking took ~18s for one clause against ~2s off.
CLASSIFY_THINKING = os.environ.get("CLASSIFY_THINKING", "")
# "" leaves effort at the model's default; otherwise low, medium or high.
CLASSIFY_EFFORT = os.environ.get("CLASSIFY_EFFORT", "")
# Review routing. With no judge model yet, a classification goes to the human
# review queue when its confidence is below the threshold, its type is high
# risk, it breaks from what its section heading implies, it fits no type, or
# it failed. High-risk entries are taxonomy keys.
CLASSIFY_CONFIDENCE_THRESHOLD = env_float("CLASSIFY_CONFIDENCE_THRESHOLD", 0.85)
CLASSIFY_HIGH_RISK_TYPES = env_list(
    "CLASSIFY_HIGH_RISK_TYPES",
    ["indemnification", "limitation-of-liability", "intellectual-property"])
# Batching. Siblings travel together; a batch closes at whichever limit it hits
# first. The item cap bounds the answer's length and what a retry costs.
CLASSIFY_MAX_BATCH_TOKENS = env_int("CLASSIFY_MAX_BATCH_TOKENS", 6000)
CLASSIFY_MAX_ITEMS_PER_BATCH = env_int("CLASSIFY_MAX_ITEMS_PER_BATCH", 20)
CLASSIFY_CONCURRENCY = env_int("CLASSIFY_CONCURRENCY", 4)
# How many requests may include one paragraph before it is recorded as failed.
CLASSIFY_ITEM_ATTEMPTS = env_int("CLASSIFY_ITEM_ATTEMPTS", 3)
# The SDK's own retries for throttling, 5xx and dropped connections, with backoff.
CLASSIFY_SDK_MAX_RETRIES = env_int("CLASSIFY_SDK_MAX_RETRIES", 4)
CLASSIFY_MAX_TOKENS = env_int("CLASSIFY_MAX_TOKENS", 16000)
CLASSIFY_BULK_BATCH_SIZE = env_int("CLASSIFY_BULK_BATCH_SIZE", 500)

# ---------------------------------------------------------------- Celery & Redis
# Upstash exposes the REST URL and token in .env, while Celery uses Redis's
# TLS wire protocol. The REST hostname and token are valid for that protocol.
CELERY_BROKER_URL = upstash_redis_url()
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_BROKER_USE_SSL = {"ssl_cert_reqs": ssl.CERT_REQUIRED}
CELERY_REDIS_BACKEND_USE_SSL = {"ssl_cert_reqs": ssl.CERT_REQUIRED}

