import hashlib
import json

from django.http import JsonResponse
from django.utils.cache import get_conditional_response
from django.utils.http import http_date
from django.views.decorators.http import require_GET, require_POST

from core.auth_helpers import require_auth
from .models import (
    CanonicalType,
    ClassificationRun,
    Document,
    ExtractionRun,
)
from .services import export_service, review_service
from .services.ingestion_service import GOOGLE_DRIVE
from .services.review_service import SaveError

# Read by a person as often as by a script: pretty-printed on purpose.
PRETTY = {'indent': 2, 'ensure_ascii': False}

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _int_param(request, name, default, maximum=None):
    """-> (value, error message). A bad number is the caller's mistake and says
    so, rather than silently falling back to the default."""
    raw = request.GET.get(name)
    if raw is None or raw == '':
        return default, None
    try:
        value = int(raw)
    except ValueError:
        return None, '%s must be a whole number.' % name
    if value < 0:
        return None, '%s cannot be negative.' % name
    if maximum is not None and value > maximum:
        value = maximum
    return value, None


def _bool_param(request, name):
    """-> True, False, or None when the parameter was not sent at all. The
    three-way answer is what lets a filter mean "either" by being absent."""
    raw = (request.GET.get(name) or '').lower()
    if raw in ('1', 'true', 'yes'):
        return True
    if raw in ('0', 'false', 'no'):
        return False
    return None


def _get_document(document_id):
    """-> (document, error response). Not get_object_or_404, so an unknown id
    answers with the same JSON shape as every other error here instead of
    Django's HTML 404 page."""
    document = Document.objects.filter(pk=document_id).select_related('current_reviewer').first()
    if document is None:
        return None, JsonResponse({'detail': 'No document with that id.'}, status=404)
    return document, None


def _stage_summary(extraction_run, classification_run, review_counts=None):
    """What a list row shows about how far the document got. A stage that has
    not run is null, not an empty object: the frontend tests one thing."""
    extraction = None
    if extraction_run is not None:
        extraction = {
            'run_id': str(extraction_run.id),
            'status': extraction_run.status,
            'attempt': extraction_run.attempt,
            'pages': extraction_run.page_count,
            'clauses': extraction_run.clause_count,
            'paragraphs': extraction_run.paragraph_count,
            'warnings': extraction_run.warning_codes,
            'extracted_at': (extraction_run.extracted_at.isoformat()
                             if extraction_run.extracted_at else None),
        }
    classification = None
    if classification_run is not None:
        classification = {
            'run_id': str(classification_run.id),
            'status': classification_run.status,
            'attempt': classification_run.attempt,
            'taxonomy_version': classification_run.taxonomy_version,
            'micro_chunks': classification_run.micro_count,
            'classified': classification_run.classified_count,
            'unclassified': classification_run.unclassified_count,
            'failed': classification_run.failed_count,
            'needs_review': classification_run.review_count,
            'classified_at': (classification_run.finished_at.isoformat()
                              if classification_run.finished_at else None),
            # How far the human pass has got on this document, so the table can
            # show progress without opening the document.
            'review': _review_progress(classification_run, review_counts or {}),
        }
    return {'extraction': extraction, 'classification': classification}


def _review_progress(classification_run, counts):
    """Decisions made against this run. Zeroed, never null: a run that exists
    always has a reviewable population, even if nobody has touched it.
    Deleted items are outside it."""
    by_decision = counts.get(classification_run.id, {})
    deleted = by_decision.get('deleted', 0)
    reviewed = sum(by_decision.values()) - deleted
    return {
        'reviewed': reviewed,
        'pending': max(classification_run.micro_count - deleted - reviewed, 0),
        'accepted': by_decision.get('accepted', 0),
        'corrected': by_decision.get('corrected', 0),
        'rejected': by_decision.get('rejected', 0),
        'deleted': deleted,
    }


def _document_links(document):
    """The detail endpoints for this row, sent with it so the frontend follows
    a link instead of building paths that go stale when one changes."""
    base = '/api/documents/%s/' % document.id
    return {
        'self': base,
        'workspace': base + 'workspace/',
        'activity': base + 'activity/',
        'extraction': base + 'extraction/',
        'classification_input': base + 'classification-input/',
        'classification': base + 'classification/',
    }


def _document_row(document, extraction_run, classification_run, review_counts=None):
    return {
        'document_id': str(document.id),
        'name': document.name,
        'title': document.document_title,
        'agreement_type': document.agreement_type,
        'sectorial_category': document.sectorial_category,
        'drive_file_id': document.source_external_id,
        'drive_folder_id': document.source_parent_id,
        'drive_web_link': document.drive_web_link or None,
        'mime_type': document.mime_type,
        'extraction_status': document.extraction_status,
        'review_status': getattr(document, 'review_status', 'needs_review'),
        'current_reviewer': (document.current_reviewer.username
                             if getattr(document, 'current_reviewer', None) else None),
        'last_extracted_at': (document.last_extracted_at.isoformat()
                              if document.last_extracted_at else None),
        'stages': _stage_summary(extraction_run, classification_run, review_counts),
        'links': _document_links(document),
    }


def _current_runs_by_document(document_ids):
    """The current extraction and classification run of every document on the
    page, in two queries rather than two per row."""
    extraction = {r.document_id: r for r in ExtractionRun.objects.filter(
        document_id__in=document_ids, is_current=True)}
    # The run of the current chunking of the current extraction: a re-chunked
    # document keeps a current classification run for every chunk run it had.
    classification = {r.document_id: r for r in ClassificationRun.objects.filter(
        document_id__in=document_ids, is_current=True,
        chunk_run__is_current=True, chunk_run__extraction_run__is_current=True)}
    return extraction, classification


@require_GET
def document_list(request):
    """The documents we hold, newest first.

    Filters, all optional and combinable:
      folder_id=<drive folder id>   repeatable; the folder the file was found in
      status=<extraction status>    repeatable; pending | extracted |
                                    extracted_with_warnings | rejected | failed
      review_status=<review status> repeatable; needs_review | in_review | draft | reviewed | published
      reviewer=<username>           filter by current reviewer username
      classified=true|false         whether a current classification run exists
      q=<text>                      substring of the file name, case-insensitive
      limit=<n>  offset=<n>         page window; limit defaults to 50, caps at 200
    """
    limit, error = _int_param(request, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
    if error:
        return JsonResponse({'detail': error}, status=400)
    offset, error = _int_param(request, 'offset', 0)
    if error:
        return JsonResponse({'detail': error}, status=400)

    # Joined by name rather than through google_drive_source(): its
    # get_or_create costs a round trip per call, and a source row that does not
    # exist yet has no documents anyway.
    documents = Document.objects.filter(ingestion_source__name=GOOGLE_DRIVE,
                                        deleted_at__isnull=True).select_related('current_reviewer')

    folder_ids = [f for f in request.GET.getlist('folder_id') if f]
    if folder_ids:
        documents = documents.filter(source_parent_id__in=folder_ids)

    statuses = [s for s in request.GET.getlist('status') if s]
    if statuses:
        allowed = {choice for choice, _ in Document.EXTRACTION_STATUS_CHOICES}
        unknown = sorted(set(statuses) - allowed)
        if unknown:
            return JsonResponse({
                'detail': 'Unknown status: %s.' % ', '.join(unknown),
                'allowed': sorted(allowed),
            }, status=400)
        documents = documents.filter(extraction_status__in=statuses)

    review_statuses = [s for s in request.GET.getlist('review_status') if s]
    if review_statuses:
        documents = documents.filter(review_status__in=review_statuses)

    reviewer = (request.GET.get('reviewer') or '').strip()
    if reviewer:
        documents = documents.filter(current_reviewer__username__icontains=reviewer)

    search = (request.GET.get('q') or '').strip()
    if search:
        documents = documents.filter(name__icontains=search)

    classified = _bool_param(request, 'classified')
    if classified is True:
        documents = documents.filter(classification_runs__is_current=True)
    elif classified is False:
        documents = documents.exclude(classification_runs__is_current=True)

    documents = documents.distinct()
    total = documents.count()
    page = list(documents.order_by('-created_at')[offset:offset + limit])
    extraction, classification = _current_runs_by_document([d.id for d in page])
    review_counts = review_service.review_counts_by_run([r.id for r in classification.values()])

    return JsonResponse({
        'documents': [_document_row(d, extraction.get(d.id), classification.get(d.id),
                                    review_counts)
                      for d in page],
        'page': {'total': total, 'limit': limit, 'offset': offset,
                 'returned': len(page), 'has_more': offset + len(page) < total},
    }, json_dumps_params=PRETTY)


@require_GET
def document_detail(request, document_id):
    """One document and the state of its stages. Exactly the row the list
    returns, so a detail page can render from either without a second shape to
    learn."""
    document, error = _get_document(document_id)
    if error:
        return error
    extraction, classification = _current_runs_by_document([document.id])
    review_counts = review_service.review_counts_by_run([r.id for r in classification.values()])
    return JsonResponse(
        _document_row(document, extraction.get(document.id), classification.get(document.id),
                      review_counts),
        json_dumps_params=PRETTY)


@require_GET
def document_extraction(request, document_id):
    """The current extraction run: every clause in reading order, then every
    paragraph with the clause it belongs to. `extraction` is null when the
    document has not been parsed."""
    document, error = _get_document(document_id)
    if error:
        return error
    return JsonResponse(export_service.extraction_json(document), json_dumps_params=PRETTY)


@require_GET
def document_classification_input(request, document_id):
    """The micro chunks of the current chunk run, grouped by section exactly as
    the classifier batches them -- what the model was shown, for explaining a
    verdict. `chunk_run` is null when the document has not been chunked."""
    document, error = _get_document(document_id)
    if error:
        return error
    return JsonResponse(export_service.classification_input_json(document),
                        json_dumps_params=PRETTY)


@require_GET
@require_auth
def document_classification(request, document_id):
    """The current classification run: a summary, then one item per micro chunk
    with its label, type, sub-type, breadcrumb, source paragraphs and confidence.

      needs_review=true   only the flagged items. The summary still counts the
                          whole run, so a queue can say "12 of 184".

    `classification_run` is null when the document has not been classified.

    `publish` says whether Update Vector DB may run, from the saved review:
    {can_publish, blockers, needs_review, rejected, missing_type, empty_text}.
    Drive the button from it; publishing enforces the same rule.

    Answers with an ETag; a request sending it back in If-None-Match gets a
    304 without the classification rows being read at all."""
    document, error = _get_document(document_id)
    if error:
        return error
    from .models import WorkspaceLock
    lock = (WorkspaceLock.objects.select_related('user')
            .filter(document_id=document_id).first())
    if lock and not lock.is_active:
        lock = None
    run = export_service.current_classification_run(document)
    vector_sync = review_service.vector_sync_state(document)
    needs_review_only = _bool_param(request, 'needs_review') is True

    # Everything the response depends on, read without touching the rows.
    # Save, Delete and Restore move document.updated_at; a re-classification
    # changes the run; the lock, the viewer and the sync state are per request.
    fingerprint = '|'.join(str(part) for part in (
        run.id if run else None, run.finished_at if run else None,
        document.updated_at, document.review_status,
        request.user.pk, lock.user_id if lock else None,
        vector_sync['pending_changes'], vector_sync['last_synced_at'],
        needs_review_only,
    ))
    etag = 'W/"%s"' % hashlib.sha1(fingerprint.encode()).hexdigest()
    last_modified = document.updated_at
    if run is not None:
        last_modified = max(last_modified, run.finished_at or run.started_at)

    # Only the ETag decides a 304: a lock or sync change moves no timestamp,
    # so If-Modified-Since alone could answer "unchanged" when it is not.
    not_modified = get_conditional_response(request, etag=etag)
    if not_modified is not None:
        return _cache_headers(not_modified, etag, last_modified)

    payload = export_service.classification_json(document)
    payload['access'] = {
        'user': {
            'id': str(request.user.pk),
            'username': request.user.username,
        },
        'is_read_only': not lock or lock.user_id != request.user.id,
        'locked_by': lock.user.username if lock else None,
        'locked_by_id': str(lock.user_id) if lock else None,
    }
    payload['document']['review_status'] = document.review_status
    payload['vector_sync'] = vector_sync
    payload['publish'] = review_service.publish_readiness(document)
    if needs_review_only:
        payload['items'] = [item for item in payload['items'] if item['needs_review']]
        payload['filtered'] = {'needs_review': True, 'returned': len(payload['items'])}
    return _cache_headers(JsonResponse(payload, json_dumps_params=PRETTY), etag, last_modified)


def _cache_headers(response, etag, last_modified):
    """Revalidate every time (no-cache), never share between users: the body
    carries the viewer's own lock state, and auth is a Bearer header."""
    response['ETag'] = etag
    response['Last-Modified'] = http_date(last_modified.timestamp())
    response['Cache-Control'] = 'private, no-cache'
    response['Vary'] = 'Authorization'
    return response


@require_POST
@require_auth
def classification_save(request, document_id):
    """The Save button: store what the reviewer did to this document.

      { "classification_run_id": "<from GET /classification/>",
        "items": [ { "classification_id": "...", "label": "Clause",
                     "type": "<taxonomy key>", "sub_type": "..." },
                   { "classification_id": "...", "decision": "rejected",
                     "note": "why" } ] }

    Send every row the reviewer changed or verified, with the values it shows
    now. Accepted or corrected is worked out here from those values. All or
    nothing: one bad row and nothing is saved. Nothing goes to the vector DB.

    -> 200 { "saved": {accepted, corrected, rejected, unchanged},
             "review_status": "...", "items": [...the rows sent, fresh...],
             "summary": {...}, "vector_sync": {...}, "publish": {...} }
    -> 400 { "detail", "errors": [{classification_id, detail}] }
    -> 403 / 423 without the workspace lock
    -> 409 { "detail", "classification_run_id" } after a re-classification
    """
    document, error = _get_document(document_id)
    if error:
        return error
    from .review_views import _check_editable
    editable, response = _check_editable(document.id, request.user)
    if not editable:
        return response

    payload, error = _json_body(request)
    if error:
        return error
    if not isinstance(payload, dict):
        return JsonResponse({'detail': 'Body must be a JSON object.'}, status=400)
    try:
        result = review_service.save_document(
            document, payload.get('classification_run_id'), payload.get('items'),
            request.user)
    except SaveError as problem:
        body = dict({'detail': str(problem)}, **problem.extra)
        if problem.errors:
            body['errors'] = problem.errors
        return JsonResponse(body, status=problem.status)

    saved = set(result['classification_ids'])
    fresh = export_service.classification_json(document)
    return JsonResponse({
        'saved': result['saved'],
        'review_status': result['review_status'],
        'items': [item for item in fresh['items'] if item['classification_id'] in saved],
        'summary': fresh['summary'],
        'vector_sync': review_service.vector_sync_state(document),
        'publish': review_service.publish_readiness(document),
    }, json_dumps_params=PRETTY)


def _item_write(request, document_id, write):
    """Shared body of Delete and Restore: lock check, JSON body, the service
    call, then the rows it touched read back fresh. write(document, payload)
    -> (result, the classification ids whose rows changed)."""
    document, error = _get_document(document_id)
    if error:
        return error
    from .review_views import _check_editable
    editable, response = _check_editable(document.id, request.user)
    if not editable:
        return response

    payload, error = _json_body(request)
    if error:
        return error
    if not isinstance(payload, dict):
        return JsonResponse({'detail': 'Body must be a JSON object.'}, status=400)
    try:
        result, touched = write(document, payload)
    except SaveError as problem:
        return JsonResponse(dict({'detail': str(problem)}, **problem.extra),
                            status=problem.status)

    fresh = export_service.classification_json(document)
    return JsonResponse(dict(
        result,
        items=[item for item in fresh['items'] if item['classification_id'] in touched],
        deleted_items=fresh['deleted_items'],
        summary=fresh['summary'],
        vector_sync=review_service.vector_sync_state(document),
        publish=review_service.publish_readiness(document),
    ), json_dumps_params=PRETTY)


@require_POST
@require_auth
def classification_delete(request, document_id, classification_id):
    """Delete one item from the review.

      { "classification_run_id": "<from GET /classification/>",
        "merge_into_next": false, "note": "optional" }

    With merge_into_next the item's text is first put at the start of the
    next item's text. The row is kept, so Restore can undo it. Nothing goes to
    the vector DB until Update Vector DB, which then removes the item.

    -> 200 { "classification_id", "merged_into", "review_status",
             "items": [the next item, when text was moved into it],
             "deleted_items": [...], "summary": {...}, "vector_sync": {...},
             "publish": {...} }
    -> 400 { "detail" } already deleted, or nothing after it to merge into
    -> 403 / 423 without the workspace lock; 404 not in the current run
    -> 409 { "detail", "classification_run_id" } after a re-classification
    """
    def write(document, payload):
        result = review_service.delete_item(
            document, payload.get('classification_run_id'), str(classification_id),
            request.user, merge_into_next=payload.get('merge_into_next', False),
            note=payload.get('note'))
        return result, {result['merged_into']}
    return _item_write(request, document_id, write)


@require_POST
@require_auth
def classification_restore(request, document_id, classification_id):
    """Undo a delete.

      { "classification_run_id": "<from GET /classification/>" }

    If the item's text was moved into the next item and is still there
    unchanged, it is taken back out (unmerged_from). If that item was edited
    since, its text is left alone (merged_text_kept_in) for the reviewer to
    tidy by hand.

    -> 200 { "classification_id", "unmerged_from", "merged_text_kept_in",
             "review_status", "items": [the restored item, and the item its
             text came back out of], "deleted_items", "summary", "vector_sync",
             "publish" }
    -> 400 not deleted; 403 / 423 without the lock; 404; 409 as for delete
    """
    def write(document, payload):
        result = review_service.restore_item(
            document, payload.get('classification_run_id'), str(classification_id),
            request.user)
        return result, {result['classification_id'], result['unmerged_from']}
    return _item_write(request, document_id, write)


def _json_body(request):
    """-> (payload, error response). A body that is not JSON is the caller's
    mistake and says so, rather than raising a 500."""
    try:
        return json.loads(request.body or b'{}'), None
    except ValueError:
        return None, JsonResponse({'detail': 'Body must be JSON.'}, status=400)


@require_GET
def taxonomy(request):
    """The types a verdict can carry, for filter menus and legends.

      version=<v>              defaults to v1, the version the current runs use
      include_inactive=true    types retired from the vocabulary

    `key` is what a classification item's `type` holds; `name` is what to show.
    """
    version = request.GET.get('version') or 'v1'
    types = CanonicalType.objects.filter(version=version)
    if _bool_param(request, 'include_inactive') is not True:
        types = types.filter(is_active=True)
    rows = [{
        'key': t.key,
        'name': t.name,
        'number': t.number,
        'applies_to': t.applies_to,
        'definition': t.definition,
        'is_active': t.is_active,
    } for t in types.order_by('applies_to', 'sort_order')]
    if not rows:
        return JsonResponse({'detail': 'No taxonomy seeded for version %s.' % version}, status=404)
    return JsonResponse({
        'version': version,
        'clause_types': [r for r in rows if r['applies_to'] == 'clause'],
        'non_clause_types': [r for r in rows if r['applies_to'] == 'non_clause'],
    }, json_dumps_params=PRETTY)
