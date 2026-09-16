"""Google Drive client construction.

Credentials come from the ingestion connector
(`document_pipeline.connectors.GoogleDrive`): `oauth.credentials_from_json`
for a signed-in web session, `main.get_credentials` for command-line runs.
This module only turns those credentials into a Drive client.
"""
from googleapiclient.discovery import build


def build_drive_client(credentials):
    """Drive v3 service bound to the given credentials."""
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


# ---------------------------------------------------------------------------
# Superseded, kept for reference.
#
# Before the ingestion connector existed, extraction was tested against the
# Drive API directly: `manage.py drive_authorize` (now
# management/commands/_drive_authorize.py) wrote a refresh token to
# settings.GOOGLE_DRIVE_TOKEN_PATH, and `parse_drive_file` rebuilt credentials
# from it with load_dev_credentials(). That was a second Drive login running
# alongside the connector's, so it is out of use.
#
# Restoring it also needs GOOGLE_DRIVE_TOKEN_PATH and the GOOGLE_OAUTH_*
# constants back in accorder_backend/settings/base.py.
#
# import json
#
# from django.conf import settings
# from django.core.exceptions import ImproperlyConfigured
# from google.oauth2.credentials import Credentials
#
# DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
# AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
# TOKEN_URI = "https://oauth2.googleapis.com/token"
#
#
# def oauth_client_config():
#     """OAuth web client configuration from settings."""
#     missing = [
#         name
#         for name in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI")
#         if not getattr(settings, name)
#     ]
#     if missing:
#         raise ImproperlyConfigured("Missing Google OAuth settings: %s" % ", ".join(missing))
#     return {
#         "web": {
#             "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
#             "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
#             "auth_uri": AUTH_URI,
#             "token_uri": TOKEN_URI,
#             "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
#         }
#     }
#
#
# def load_dev_credentials():
#     """Credentials from the locally stored refresh token."""
#     path = settings.GOOGLE_DRIVE_TOKEN_PATH
#     if not path.exists():
#         raise ImproperlyConfigured(
#             "No Drive token at %s. Run `python manage.py drive_authorize` first." % path
#         )
#     data = json.loads(path.read_text(encoding="utf-8"))
#     config = oauth_client_config()["web"]
#     return Credentials(
#         token=None,
#         refresh_token=data["refresh_token"],
#         token_uri=TOKEN_URI,
#         client_id=config["client_id"],
#         client_secret=config["client_secret"],
#         scopes=[DRIVE_READONLY_SCOPE],
#     )
#
#
# def save_dev_credentials(credentials):
#     """Persist the refresh token outside version control."""
#     if not credentials.refresh_token:
#         raise ImproperlyConfigured(
#             "Google returned no refresh token. Remove this app's access at "
#             "https://myaccount.google.com/permissions and authorize again."
#         )
#     path = settings.GOOGLE_DRIVE_TOKEN_PATH
#     path.parent.mkdir(parents=True, exist_ok=True)
#     path.write_text(json.dumps({"refresh_token": credentials.refresh_token}), encoding="utf-8")
#     return path
