import json

from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .models import (
    CanonicalType,
    Classification,
    ClassificationRun,
    Document,
    ExtractionRun,
)
from .services import export_service, review_service
from .services.ingestion_service import google_drive_source
from .services.review_service import ReviewError

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
    document = Document.objects.filter(pk=document_id).first()
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
    always has a reviewable population, even if nobody has touched it."""
    by_decision = counts.get(classification_run.id, {})
    reviewed = sum(by_decision.values())
    return {
        'reviewed': reviewed,
        'pending': max(classification_run.micro_count - reviewed, 0),
        'accepted': by_decision.get('accepted', 0),
        'corrected': by_decision.get('corrected', 0),
        'rejected': by_decision.get('rejected', 0),
    }


def _document_links(document):
    """The detail endpoints for this row, sent with it so the frontend follows
    a link instead of building paths that go stale when one changes."""
    base = '/api/documents/%s/' % document.id
    return {
        'self': base,
        'extraction': base + 'extraction/',
        'classification_input': base + 'classification-input/',
        'classification': base + 'classification/',
    }


def _document_row(document, extraction_run, classification_run, review_counts=None):
    return {
        'document_id': str(document.id),
        'name': document.name,
        'title': document.document_title,
        'drive_file_id': document.source_external_id,
        'drive_folder_id': document.source_parent_id,
        'drive_web_link': document.drive_web_link or None,
        'mime_type': document.mime_type,
        'extraction_status': document.extraction_status,
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
    classification = {r.document_id: r for r in ClassificationRun.objects.filter(
        document_id__in=document_ids, is_current=True)}
    return extraction, classification


@require_GET
def document_list(request):
    """The documents we hold, newest first.

    Filters, all optional and combinable:
      folder_id=<drive folder id>   repeatable; the folder the file was found in
      status=<extraction status>    repeatable; pending | extracted |
                                    extracted_with_warnings | rejected | failed
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

    documents = Document.objects.filter(ingestion_source=google_drive_source(),
                                        deleted_at__isnull=True)

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

    search = (request.GET.get('q') or '').strip()
    if search:
        documents = documents.filter(name__icontains=search)

    classified = _bool_param(request, 'classified')
    if classified is True:
        documents = documents.filter(classification_runs__is_current=True)
    elif classified is False:
        documents = documents.exclude(classification_runs__is_current=True)

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
def document_classification(request, document_id):
    """The current classification run: a summary, then one item per micro chunk
    with its label, type, sub-type, breadcrumb, source paragraphs and confidence.

      needs_review=true   only the flagged items. The summary still counts the
                          whole run, so a queue can say "12 of 184".

    `classification_run` is null when the document has not been classified."""
    document, error = _get_document(document_id)
    if error:
        return error
    payload = export_service.classification_json(document)
    if _bool_param(request, 'needs_review') is True:
        payload['items'] = [item for item in payload['items'] if item['needs_review']]
        payload['filtered'] = {'needs_review': True, 'returned': len(payload['items'])}
    return JsonResponse(payload, json_dumps_params=PRETTY)


def _json_body(request):
    """-> (payload, error response). A body that is not JSON is the caller's
    mistake and says so, rather than raising a 500."""
    try:
        return json.loads(request.body or b'{}'), None
    except ValueError:
        return None, JsonResponse({'detail': 'Body must be JSON.'}, status=400)


def _item_for(classification):
    """The one decided item, in exactly the shape `items` uses in the
    classification response.

    Returned from a write so the client swaps the row into state instead of
    refetching the document, and so there is only one item shape to learn.
    """
    payload = export_service.classification_json(classification.run.document)
    target = str(classification.id)
    for item in payload['items']:
        if item['classification_id'] == target:
            return item
    return None


@require_POST
def classification_review(request, classification_id):
    """Record a reviewer's decision about one classification.

      { "decision": "accepted" | "corrected" | "rejected",
        "type": "<taxonomy key>",   required for corrected, absent otherwise
        "label": "Clause" | "Non-clause",       optional; defaults to the verdict
        "sub_type": "...",                      optional; never on a Non-clause
        "note": "..." }                         optional; required for rejected

    -> 200 with the updated item, in the same shape `items` uses.

    Deciding again supersedes the previous decision and keeps it: the trail of
    who changed their mind survives. The reviewer is taken from the Drive
    session, never from the body.
    """
    classification = (Classification.objects
                      .select_related('run', 'run__document')
                      .filter(pk=classification_id).first())
    if classification is None:
        return JsonResponse({'detail': 'No classification with that id.'}, status=404)

    payload, error = _json_body(request)
    if error:
        return error
    try:
        review_service.record_decision(classification, payload,
                                       review_service.reviewer_from_session(request))
    except ReviewError as problem:
        return JsonResponse({'detail': str(problem)}, status=400)
    return JsonResponse(_item_for(classification), json_dumps_params=PRETTY)


@require_GET
def classification_review_history(request, classification_id):
    """Every decision ever made about one classification, newest first.

    Ordered by `revision`, not by time: a bulk accept writes many rows in the
    same microsecond, and timestamps tie. `is_current` marks the one in force;
    the rest are what it replaced, which is the point of keeping them.
    """
    classification = Classification.objects.filter(pk=classification_id).first()
    if classification is None:
        return JsonResponse({'detail': 'No classification with that id.'}, status=404)
    rows = (classification.reviews.select_related('canonical_type')
            .order_by('-revision'))
    return JsonResponse({
        'classification_id': str(classification.id),
        'reviews': [dict(review_service.review_json(r), is_current=r.is_current) for r in rows],
    }, json_dumps_params=PRETTY)


@require_POST
def document_reviews(request, document_id):
    """Record several decisions for one document at once.

      { "decisions": [ { "classification_id": "...", "decision": "accepted" }, ... ] }

    Each entry takes the same fields as the single endpoint. All or nothing:
    the batch is validated before anything is written, so "accept everything
    visible" either lands whole or leaves the queue exactly as it was.

    -> 200 { "updated": 38, "items": [...], "summary": {...} }, where `items`
    holds only the rows that changed and `summary` is the whole run, so a
    header can be re-rendered from one response.
    """
    document, error = _get_document(document_id)
    if error:
        return error
    payload, error = _json_body(request)
    if error:
        return error
    try:
        reviews = review_service.record_decisions(
            document, payload.get('decisions'),
            review_service.reviewer_from_session(request))
    except ReviewError as problem:
        return JsonResponse({'detail': str(problem)}, status=400)

    changed = {str(r.classification_id) for r in reviews}
    fresh = export_service.classification_json(document)
    return JsonResponse({
        'updated': len(reviews),
        'items': [item for item in fresh['items'] if item['classification_id'] in changed],
        'summary': fresh['summary'],
    }, json_dumps_params=PRETTY)


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
