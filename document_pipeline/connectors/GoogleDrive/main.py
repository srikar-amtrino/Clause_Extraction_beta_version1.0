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

def get_credentials():
    """Retain the command-line helper for manually running this module."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    # Reuse saved token if it exists
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    # If no valid creds, run the login flow (opens a browser window once)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CLIENT_SECRET_FILE, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save the token so we don't need to log in again next run
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())

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