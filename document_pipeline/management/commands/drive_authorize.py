"""Development only: authorize read-only Drive access for local testing.

Prints Google's consent URL for the configured OAuth client. After consenting,
the browser is sent to the redirect URI; paste that full address back here.
The page itself may fail to load, which is expected when nothing is serving
the redirect URI locally. The refresh token is stored at
GOOGLE_DRIVE_TOKEN_PATH, which is excluded from version control.
"""
import os

from django.core.management.base import BaseCommand, CommandError
from google_auth_oauthlib.flow import Flow

from config.google_drive import DRIVE_READONLY_SCOPE, oauth_client_config, save_dev_credentials


class Command(BaseCommand):
    help = "Development only: authorize read-only Google Drive access and store a refresh token."

    def handle(self, *args, **options):
        config = oauth_client_config()
        redirect_uri = config["web"]["redirect_uris"][0]

        if redirect_uri.startswith(("http://localhost", "http://127.0.0.1")):
            # oauthlib refuses plain http unless told this is a local redirect
            os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
        # Google may return previously granted scopes alongside the requested one
        os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

        flow = Flow.from_client_config(config, scopes=[DRIVE_READONLY_SCOPE], redirect_uri=redirect_uri)
        auth_url, _state = flow.authorization_url(access_type="offline", prompt="consent")

        self.stdout.write("Open this URL, sign in and allow access:\n\n%s\n" % auth_url)
        response = input("Paste the full address you were redirected to: ").strip()
        if not response:
            raise CommandError("Nothing pasted.")

        try:
            if response.startswith("http"):
                flow.fetch_token(authorization_response=response)
            else:
                flow.fetch_token(code=response)
        except Exception as exc:
            raise CommandError("Token exchange failed: %s" % exc) from exc

        path = save_dev_credentials(flow.credentials)
        self.stdout.write(self.style.SUCCESS("Refresh token saved to %s" % path))
