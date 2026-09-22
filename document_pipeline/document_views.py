from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .models import CanonicalType, ClassificationRun, Document, ExtractionRun
from .services import export_service
from .services.ingestion_service import google_drive_source

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


def _stage_summary(extraction_run, classification_run):
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
        }
    return {'extraction': extraction, 'classification': classification}


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


def _document_row(document, extraction_run, classification_run):
    return {
        'document_id': str(document.id),
        'name': document.name,
        'title': document.document_title,
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
        'stages': _stage_summary(extraction_run, classification_run),
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

    documents = Document.objects.filter(ingestion_source=google_drive_source(),
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

    total = documents.count()
    page = list(documents.order_by('-created_at')[offset:offset + limit])
    extraction, classification = _current_runs_by_document([d.id for d in page])

    return JsonResponse({
        'documents': [_document_row(d, extraction.get(d.id), classification.get(d.id))
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
    return JsonResponse(
        _document_row(document, extraction.get(document.id), classification.get(document.id)),
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
    with its label, type, sub-type, confidence and reason.

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
