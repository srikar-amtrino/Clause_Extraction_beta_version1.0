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
from .models import Document
from .services.ingestion_service import google_drive_source, plan_dispatch, sync_drive_files
from .tasks.orchestrate import trigger_full_document_pipeline


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
    # Dispatch may have rejected a document after the sync loaded it, so the
    # status is re-read rather than taken from the objects the sync returned.
    statuses = dict(Document.objects.filter(id__in=[d.id for d in outcome.changed])
                    .values_list('id', 'extraction_status'))
    for document in outcome.changed:
        document.extraction_status = statuses.get(document.id, document.extraction_status)
    return {
        'added': [_document_summary(d) for d in outcome.created],
        'updated': [_document_summary(d) for d in outcome.updated],
        'renamed': [_document_summary(d) for d in outcome.renamed],
        'moved': [_document_summary(d) for d in outcome.moved],
        'restored': [_document_summary(d) for d in outcome.restored],
        'deleted': [_document_summary(d) for d in outcome.deleted],
        'unchanged': outcome.unchanged,
    }


def _sync_and_queue(credentials, folders, folder_ids):
    current_files = _flatten_files(folders)
    print(f'[http] syncing {len(current_files)} Drive files', flush=True)
    source = google_drive_source()
    outcome = sync_drive_files(current_files,
                               ingestion_source=source,
                               folder_ids=folder_ids)
    changed_documents = outcome.created + outcome.updated + outcome.restored
    changed_ids = {document.id for document in changed_documents}
    current_documents = Document.objects.filter(
        ingestion_source=source,
        source_external_id__in=current_files,
        deleted_at__isnull=True,
    )
    # Only a Word .docx reaches Celery. Anything else is refused here, by
    # Drive's reported type, and recorded with its reason.
    plan = plan_dispatch(current_documents, changed_ids)

    from document_pipeline.pipeline_logger import (
        log_celery_task_dispatched,
        log_drive_connected,
        log_folder_selected,
    )

    task_ids = []
    refreshed_credentials_json = credentials.to_json()
    for document in plan.to_ingest:
        # Parsing and chunking together: a parsed document nothing has chunked
        # holds no chunks to retrieve, cite or classify, so stopping after the
        # parse would leave every synced document half-ingested until someone
        # ran chunk_documents by hand.
        result = trigger_full_document_pipeline(refreshed_credentials_json, str(document.id))
        task_ids.append(result.id)
        log_celery_task_dispatched("trigger_full_document_pipeline", str(result.id), "streaming_io_queue -> parsing_queue -> llm_queue", str(document.id))
    print(f'[http] queued {len(task_ids)} ingestion tasks, '
          f'{len(plan.rejected)} files not parseable', flush=True)
    return outcome, plan, task_ids, refreshed_credentials_json


def _ingestion_payload(plan, task_ids):
    return {
        'status': 'queued',
        'task_ids': task_ids,
        'document_ids': [str(document.id) for document in plan.to_ingest],
        'rejected': [
            {**_document_summary(document), 'kind': rejection.kind, 'reason': str(rejection)}
            for document, rejection in plan.rejected
        ],
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
    user_info = get_user_details(credentials)
    request.session['google_drive_user'] = user_info

    # Save session to ensure session_key exists, then log
    if not request.session.session_key:
        request.session.save()
    from document_pipeline.pipeline_logger import log_drive_connected
    log_drive_connected(user_info, request.session.session_key)

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
    """Save the selected folders and queue their first ingestion."""
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
        current_files = _flatten_files(folders)
        from document_pipeline.pipeline_logger import log_folder_selected
        log_folder_selected(folder_ids, folders, len(current_files))

        outcome, plan, task_ids, credentials_json = _sync_and_queue(
            credentials, folders, folder_ids)
        request.session['google_drive_folder_ids'] = folder_ids
        request.session['google_drive_credentials'] = credentials_json
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': folder_ids,
            'changes': _changes_payload(outcome),
            'ingestion': _ingestion_payload(plan, task_ids),
            'folders': folders,
        }, status=202)
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive request failed.', 'error': str(error)}, status=502)


@require_POST
def google_drive_sync(request):
    """Reconcile Drive metadata, then queue changed documents for ingestion."""
    print('[http] Google Drive sync requested', flush=True)
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
        from document_pipeline.pipeline_logger import log_folder_selected
        log_folder_selected(folder_ids, folders, len(current_files))

        outcome, plan, task_ids, credentials_json = _sync_and_queue(
            credentials, folders, folder_ids)
        request.session['google_drive_credentials'] = credentials_json
        return JsonResponse({
            'user': request.session.get('google_drive_user'),
            'folder_ids': folder_ids,
            'changes': _changes_payload(outcome),
            'ingestion': _ingestion_payload(plan, task_ids),
            'folders': folders,
        }, status=202)
    except (FileNotFoundError, ValueError) as error:
        return JsonResponse({'detail': str(error)}, status=500)
    except HttpError as error:
        return JsonResponse({'detail': 'Google Drive sync failed.', 'error': str(error)}, status=502)