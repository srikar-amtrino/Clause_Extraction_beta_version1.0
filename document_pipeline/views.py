import os

from django.http import JsonResponse
from django.shortcuts import redirect
from django.views.decorators.http import require_GET, require_POST
from googleapiclient.errors import HttpError
from oauthlib.oauth2 import OAuth2Error

from .connectors.GoogleDrive.main import get_folder_tree
from .connectors.GoogleDrive.oauth import (
    build_auth_url,
    credentials_from_json,
    exchange_code_for_tokens,
    get_user_details,
)


def _flatten_files(folders):
    files = {}
    for folder in folders:
        for file in folder.get('files', []):
            files[file['id']] = file
        for child in folder.get('children', []):
            files.update(_flatten_files([child]))
    return files


def _build_folder_snapshot(request, credentials, folder_ids):
    folders = []
    visited_folders = set()
    for folder_id in dict.fromkeys(folder_ids):
        folder = get_folder_tree(
            folder_id,
            credentials,
            visited_folders=visited_folders,
        )
        if folder:
            folders.append(folder)
    return folders


def _sync_changes(previous_files, current_files):
    previous_files = previous_files or {}
    added = [file for file_id, file in current_files.items() if file_id not in previous_files]
    deleted = [file for file_id, file in previous_files.items() if file_id not in current_files]
    renamed = []
    moved = []
    updated = []

    for file_id in current_files.keys() & previous_files.keys():
        old_file = previous_files[file_id]
        new_file = current_files[file_id]
        if old_file.get('name') != new_file.get('name'):
            renamed.append({'before': old_file, 'after': new_file})
        elif old_file.get('parent_id') != new_file.get('parent_id'):
            moved.append({'before': old_file, 'after': new_file})
        elif old_file != new_file:
            updated.append({'before': old_file, 'after': new_file})

    return {
        'added': added,
        'updated': updated,
        'renamed': renamed,
        'moved': moved,
        'deleted': deleted,
    }


@require_GET
def google_drive_connect(request):
    auth_url, state, code_verifier = build_auth_url()
    request.session['google_drive_oauth_state'] = state
    request.session['google_drive_oauth_code_verifier'] = code_verifier
    request.session['google_drive_oauth_next'] = os.getenv(
        'GOOGLE_OAUTH_FRONTEND_URL',
        'http://127.0.0.1:5173/overview',
    )
    return redirect(auth_url)


@require_GET
def google_drive_callback(request):
    error = request.GET.get('error')
    if error:
        return JsonResponse({'detail': f'Google authorization failed: {error}'}, status=400)

    code = request.GET.get('code')
    if not code:
        return JsonResponse({'detail': 'Google did not return an authorization code.'}, status=400)
    if request.GET.get('state') != request.session.pop('google_drive_oauth_state', None):
        return JsonResponse({'detail': 'Invalid OAuth state.'}, status=400)

    code_verifier = request.session.pop('google_drive_oauth_code_verifier', None)
    try:
        credentials = exchange_code_for_tokens(code, code_verifier)
    except OAuth2Error as error:
        return JsonResponse({
            'detail': 'Google token exchange failed. Start the connection again.',
            'error': str(error),
        }, status=400)
    request.session['google_drive_credentials'] = credentials.to_json()
    request.session['google_drive_user'] = get_user_details(credentials)
    return redirect(request.session.pop(
        'google_drive_oauth_next',
        os.getenv('GOOGLE_OAUTH_FRONTEND_URL', 'http://127.0.0.1:5173/overview'),
    ))


@require_GET
def google_drive_picker_token(request):
    credentials_json = request.session.get('google_drive_credentials')
    if not credentials_json:
        return JsonResponse({'detail': 'Connect Google Drive first.'}, status=401)
    try:
        credentials = credentials_from_json(credentials_json)
        request.session['google_drive_credentials'] = credentials.to_json()
        return JsonResponse({'access_token': credentials.token})
    except ValueError as error:
        return JsonResponse({'detail': str(error)}, status=401)


@require_GET
def google_drive_picker_config(request):
    if 'google_drive_credentials' not in request.session:
        return JsonResponse({'detail': 'Connect Google Drive first.'}, status=401)
    return JsonResponse({
        'api_key': os.getenv('GOOGLE_PICKER_API_KEY', ''),
        'app_id': os.getenv('GOOGLE_PICKER_APP_ID', ''),
    })


@require_GET
def google_drive_files(request):
    """List files directly inside all folders selected in Google Picker."""
    folder_ids = request.GET.getlist('folder_id')

    try:
        if not folder_ids:
            return JsonResponse({'detail': 'At least one folder_id is required.'}, status=400)
        credentials_json = request.session.get('google_drive_credentials')
        if not credentials_json:
            return JsonResponse({'detail': 'Connect Google Drive first.'}, status=401)
        credentials = credentials_from_json(credentials_json)
        folder_ids = list(dict.fromkeys(folder_ids))
        folders = _build_folder_snapshot(request, credentials, folder_ids)
        request.session['google_drive_folder_ids'] = folder_ids
        request.session['google_drive_file_snapshot'] = _flatten_files(folders)
        for folder in folders:
            print(folder)
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': list(dict.fromkeys(folder_ids)),
            'folders': folders,
        })
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive request failed.', 'error': str(error)}, status=502)


@require_POST
def google_drive_sync(request):
    """Compare the current Drive state with the last selected-folder snapshot."""
    credentials_json = request.session.get('google_drive_credentials')
    folder_ids = request.session.get('google_drive_folder_ids', [])
    if not credentials_json:
        return JsonResponse({'detail': 'Connect Google Drive first.'}, status=401)
    if not folder_ids:
        return JsonResponse({'detail': 'Select at least one folder first.'}, status=400)

    try:
        credentials = credentials_from_json(credentials_json)
        folders = _build_folder_snapshot(request, credentials, folder_ids)
        current_files = _flatten_files(folders)
        changes = _sync_changes(
            request.session.get('google_drive_file_snapshot', {}),
            current_files,
        )
        request.session['google_drive_credentials'] = credentials.to_json()
        request.session['google_drive_file_snapshot'] = current_files
        for change_type, files in changes.items():
            for file in files:
                print(change_type, file)
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': folder_ids,
            'changes': changes,
            'folders': folders,
        })
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive sync failed.', 'error': str(error)}, status=502)