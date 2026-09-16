import os
import json
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

CONNECTOR_DIR = Path(__file__).resolve().parent
SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
]


def _client_config():
    client_id = os.getenv('GOOGLE_OAUTH_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_OAUTH_CLIENT_SECRET')
    redirect_uri = os.getenv(
        'GOOGLE_OAUTH_REDIRECT_URI',
        'http://127.0.0.1:8000/api/google-drive/oauth/callback/',
    )

    if not client_id or not client_secret:
        with open(CONNECTOR_DIR / 'client_secret.json', encoding='utf-8') as secret_file:
            client_data = json.load(secret_file)
            config = client_data.get('web') or client_data.get('installed')
        client_id = config['client_id']
        client_secret = config['client_secret']

    return {
        'web': {
            'client_id': client_id,
            'client_secret': client_secret,
            'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
            'token_uri': 'https://oauth2.googleapis.com/token',
            'redirect_uris': [redirect_uri],
        }
    }, redirect_uri


def build_auth_url():
    client_config, redirect_uri = _client_config()
    flow = Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # ensures a refresh_token is returned
    )
    return auth_url, state, flow.code_verifier


def exchange_code_for_tokens(code: str, code_verifier: str | None = None) -> Credentials:
    client_config, redirect_uri = _client_config()
    flow = Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=redirect_uri)
    if code_verifier:
        flow.code_verifier = code_verifier
    flow.fetch_token(code=code)
    return flow.credentials


def credentials_from_json(credentials_json: str) -> Credentials:
    creds = Credentials.from_authorized_user_info(json.loads(credentials_json), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            raise ValueError('Stored Drive credentials are invalid; reconnect Google Drive.')

    return creds


def get_user_details(credentials: Credentials) -> dict:
    """Return non-sensitive Google account details for the current user."""
    from googleapiclient.discovery import build

    service = build('oauth2', 'v2', credentials=credentials)
    profile = service.userinfo().get().execute()
    return {
        'id': profile.get('id'),
        'email': profile.get('email'),
        'name': profile.get('name'),
        'picture': profile.get('picture'),
    }