import os
import json

from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST
from googleapiclient.errors import HttpError
from oauthlib.oauth2 import OAuth2Error

from core.models import Contract, ContractType, IngestionSource, User
from .connectors.GoogleDrive.main import get_folder_tree
from .connectors.GoogleDrive.oauth import (
    build_auth_url,
    credentials_from_json,
    exchange_code_for_tokens,
    get_user_details,
)
from .services.ingestion_service import google_drive_source, sync_drive_files


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


def _document_summary(document):
    return {
        'id': str(document.id),
        'drive_file_id': document.source_external_id,
        'name': document.name,
        'mime_type': document.mime_type,
        'extraction_status': document.extraction_status,
    }


def _changes_payload(outcome):
    return {
        'added': [_document_summary(d) for d in outcome.created],
        'updated': [_document_summary(d) for d in outcome.updated],
        'renamed': [_document_summary(d) for d in outcome.renamed],
        'moved': [_document_summary(d) for d in outcome.moved],
        'restored': [_document_summary(d) for d in outcome.restored],
        'deleted': [_document_summary(d) for d in outcome.deleted],
        'unchanged': outcome.unchanged,
    }


def _persist_drive_file_snapshot(files_by_id, user_email=None):
    source, _ = IngestionSource.objects.get_or_create(
        name='Google Drive',
        defaults={
            'source_type': 'google_drive',
            'description': 'Google Drive ingestion source',
        },
    )
    contract_type = ContractType.objects.filter(name='MSA').first()
    if contract_type is None:
        contract_type = ContractType.objects.create(
            name='MSA',
            description='Default contract type for Drive-discovered files',
        )

    user = None
    if user_email:
        user, _ = User.objects.get_or_create(
            email=user_email,
            defaults={'name': user_email.split('@')[0].title()},
        )

    created_count = 0
    updated_count = 0
    persisted = []
    for file_data in files_by_id.values():
        file_id = file_data.get('id')
        file_name = file_data.get('name')
        if not file_id or not file_name:
            continue

        contract, created = Contract.objects.get_or_create(
            source=source,
            source_external_id=file_id,
            defaults={
                'name': file_name,
                'original_filename': file_name,
                'contract_type': contract_type,
                'sector': None,
                'opened_by': user,
                'pipeline_status': 'discovered',
            },
        )
        if created:
            created_count += 1
        else:
            changed = False
            if contract.name != file_name:
                contract.name = file_name
                changed = True
            if contract.original_filename != file_name:
                contract.original_filename = file_name
                changed = True
            if contract.contract_type_id != contract_type.id:
                contract.contract_type = contract_type
                changed = True
            if contract.opened_by_id != (user.id if user else None):
                contract.opened_by = user
                changed = True
            if changed:
                contract.save(update_fields=['name', 'original_filename', 'contract_type', 'opened_by', 'updated_at'])
                updated_count += 1

        persisted.append({
            'id': contract.id,
            'source_external_id': contract.source_external_id,
            'name': contract.name,
            'original_filename': contract.original_filename,
            'pipeline_status': contract.pipeline_status,
            'created': created,
        })

    return {'created': created_count, 'updated': updated_count, 'contracts': persisted}


@require_GET
def google_drive_connect(request):
    auth_url, state, code_verifier = build_auth_url()
    request.session['google_drive_oauth_state'] = state
    request.session['google_drive_oauth_code_verifier'] = code_verifier
    request.session['google_drive_oauth_next'] = reverse('google-drive-picker')
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
    return redirect(request.session.pop('google_drive_oauth_next', reverse('google-drive-picker')))


@require_GET
def google_drive_picker(request):
    if 'google_drive_credentials' not in request.session:
        return redirect('google-drive-connect')

    return render(request, 'google_drive/picker.html', {
        'picker_api_key': os.getenv('GOOGLE_PICKER_API_KEY', ''),
        'picker_app_id': os.getenv('GOOGLE_PICKER_APP_ID', ''),
        'google_drive_user': request.session.get('google_drive_user', {}),
        'google_drive_user_json': json.dumps(request.session.get('google_drive_user', {})),
    })


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
        request.session['google_drive_file_snapshot'] = current_files

        user_email = (request.session.get('google_drive_user') or {}).get('email')
        persisted = _persist_drive_file_snapshot(current_files, user_email=user_email)

        for folder in folders:
            print(folder)
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': list(dict.fromkeys(folder_ids)),
            'folders': folders,
            'database': persisted,
        })
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive request failed.', 'error': str(error)}, status=502)


@require_POST
def google_drive_sync(request):
    """Reconcile the selected Drive folders against the document table.

    Metadata only: this records what exists and what changed, and never
    downloads a file. Parsing is driven separately by `manage.py
    ingest_drive_files`, because a folder of any size would otherwise make this
    request run for minutes.
    """
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
        outcome = sync_drive_files(current_files,
                                   ingestion_source=google_drive_source(),
                                   folder_ids=folder_ids)
        request.session['google_drive_credentials'] = credentials.to_json()
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': folder_ids,
            'changes': _changes_payload(outcome),
            'folders': folders,
        })
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive sync failed.', 'error': str(error)}, status=502)
