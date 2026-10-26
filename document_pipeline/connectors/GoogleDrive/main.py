import json
import os
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Read-only scope is enough for listing/ingesting files.
# Use 'drive' (full) instead of 'drive.readonly' only if you also need to write/move files.
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

CONNECTOR_DIR = Path(__file__).resolve().parent
CLIENT_SECRET_FILE = str(CONNECTOR_DIR / 'client_secret.json')
TOKEN_FILE = str(CONNECTOR_DIR / 'token.json')
# Where a command-line login stores its token. Outside the repo tree and
# git-ignored; the same path the picker's connector writes.
DEV_TOKEN_FILE = str(Path(os.getenv('GOOGLE_DRIVE_TOKEN_PATH')
                          or '.secrets/drive_token.json'))
TOKEN_URI = 'https://oauth2.googleapis.com/token'


def _stored_credentials(path):
    """Credentials rebuilt from a token file, or None when there is no usable one.

    Two shapes are accepted, because two things write these files: the full
    authorized-user JSON google-auth itself emits, and the bare
    {"refresh_token": ...} the command-line authorization wrote. A refresh
    token plus the OAuth client from the environment is all that is needed to
    mint an access token, so the short form stays valid.
    """
    if not os.path.exists(path):
        return None
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None

    if data.get('client_id') and data.get('client_secret'):
        return Credentials.from_authorized_user_info(data, SCOPES)

    refresh_token = data.get('refresh_token')
    client_id = os.getenv('GOOGLE_OAUTH_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_OAUTH_CLIENT_SECRET')
    if not (refresh_token and client_id and client_secret):
        return None
    return Credentials(token=None, refresh_token=refresh_token, token_uri=TOKEN_URI,
                       client_id=client_id, client_secret=client_secret, scopes=SCOPES)


def _save(credentials, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(credentials.to_json(), encoding='utf-8')


def get_credentials():
    """Drive credentials for a command-line run. -> Credentials

    Ingestion runs headless -- a management command, a Celery worker, a cron --
    so a stored token is tried before anything that needs a human. Only when no
    token can be refreshed does this fall back to the browser flow, which needs
    client_secret.json and someone sitting at the machine.
    """
    from google_auth_oauthlib.flow import InstalledAppFlow

    for path in (TOKEN_FILE, DEV_TOKEN_FILE):
        creds = _stored_credentials(path)
        if creds is None:
            continue
        if creds.valid:
            return creds
        if creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                continue    # revoked or the client changed; try the next source
            _save(creds, path)
            return creds

    if not os.path.exists(CLIENT_SECRET_FILE):
        raise RuntimeError(
            'No usable Google Drive credentials. Expected a token at %s or %s, '
            'or %s to run the browser sign-in. Connect Drive through the picker, '
            'or place the OAuth client file.'
            % (TOKEN_FILE, DEV_TOKEN_FILE, CLIENT_SECRET_FILE))

    flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_FILE, SCOPES)
    creds = flow.run_local_server(port=0)
    _save(creds, TOKEN_FILE)
    return creds

def list_files_in_folder(folder_id, creds=None):
    creds = creds or get_credentials()
    service = build('drive', 'v3', credentials=creds)

    return _list_children(service, folder_id)


def _list_children(service, folder_id):
    files = []
    page_token = None
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageToken=page_token,
        ).execute()

        files.extend(response.get('files', []))
        page_token = response.get('nextPageToken')
        if not page_token:
            break

    return files


def list_files_recursively(folder_id, creds=None):
    """Return files in a folder and every descendant folder."""
    creds = creds or get_credentials()
    service = build('drive', 'v3', credentials=creds)
    files = []
    visited_folders = set()

    def walk(current_folder_id):
        if current_folder_id in visited_folders:
            return
        visited_folders.add(current_folder_id)

        for item in _list_children(service, current_folder_id):
            if item['mimeType'] == 'application/vnd.google-apps.folder':
                walk(item['id'])
            else:
                files.append({**item, 'folder_id': current_folder_id})

    walk(folder_id)
    return files


def get_folder_tree(folder_id, creds=None, parent_id=None, visited_folders=None):
    """Return a nested folder tree with each folder's direct files."""
    creds = creds or get_credentials()
    service = build('drive', 'v3', credentials=creds)
    if visited_folders is None:
        visited_folders = set()
    return _get_folder_tree(
        service,
        folder_id,
        parent_id=parent_id,
        visited_folders=visited_folders,
    )


def _get_folder_tree(service, folder_id, parent_id, visited_folders):
    if folder_id in visited_folders:
        return None
    visited_folders.add(folder_id)

    folder = {
        'folder_id': folder_id,
        'parent_id': parent_id,
        'files': [],
        'children': [],
    }
    for item in _list_children(service, folder_id):
        if item['mimeType'] == 'application/vnd.google-apps.folder':
            child = _get_folder_tree(service, item['id'], folder_id, visited_folders)
            if child:
                child.update({
                    'name': item['name'],
                    'mimeType': item['mimeType'],
                    'modifiedTime': item.get('modifiedTime'),
                })
                folder['children'].append(child)
        else:
            folder['files'].append({**item, 'parent_id': folder_id})

    return folder


def list_folders():
    creds = get_credentials()
    service = build('drive', 'v3', credentials=creds)

    folders = []
    page_token = None
    while True:
        response = service.files().list(
            q="mimeType='application/vnd.google-apps.folder' and trashed=false",
            fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
            orderBy='name',
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            pageToken=page_token,
        ).execute()

        folders.extend(response.get('files', []))
        page_token = response.get('nextPageToken')
        if not page_token:
            break

    return folders

if __name__ == '__main__':
    FOLDER_ID = '0AOk0SoljU9rSUk9PVA'
    for f in list_files_in_folder(FOLDER_ID):
        print(f["name"], "-", f["mimeType"], "-", f["id"])