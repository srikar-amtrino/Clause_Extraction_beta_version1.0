"""Google Drive client construction.

`build_drive_client` is the single point where credentials enter the pipeline.
It accepts any `google.oauth2.credentials.Credentials`, so the signed-in user's
credentials from the ingestion/auth layer can be passed in directly.

`load_dev_credentials` and `save_dev_credentials` exist only for local testing
before that auth layer is available. They read and write a refresh token
produced by `python manage.py drive_authorize`.
"""
import json

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"


def build_drive_client(credentials):
    """Drive v3 service bound to the given credentials."""
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def oauth_client_config():
    """OAuth web client configuration from settings."""
    missing = [
        name
        for name in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI")
        if not getattr(settings, name)
    ]
    if missing:
        raise ImproperlyConfigured("Missing Google OAuth settings: %s" % ", ".join(missing))
    return {
        "web": {
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
        }
    }


def load_dev_credentials():
    """Development only. Credentials from the locally stored refresh token."""
    path = settings.GOOGLE_DRIVE_TOKEN_PATH
    if not path.exists():
        raise ImproperlyConfigured(
            "No Drive token at %s. Run `python manage.py drive_authorize` first." % path
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    config = oauth_client_config()["web"]
    return Credentials(
        token=None,
        refresh_token=data["refresh_token"],
        token_uri=TOKEN_URI,
        client_id=config["client_id"],
        client_secret=config["client_secret"],
        scopes=[DRIVE_READONLY_SCOPE],
    )


def save_dev_credentials(credentials):
    """Development only. Persist the refresh token outside version control."""
    if not credentials.refresh_token:
        raise ImproperlyConfigured(
            "Google returned no refresh token. Remove this app's access at "
            "https://myaccount.google.com/permissions and authorize again."
        )
    path = settings.GOOGLE_DRIVE_TOKEN_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"refresh_token": credentials.refresh_token}), encoding="utf-8")
    return path
