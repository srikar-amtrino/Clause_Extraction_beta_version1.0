"""Helper for creating DocumentActivityLog entries.

Import and call ``log_activity`` from any task or view that mutates a
document. Failures are logged but never re-raised -- a missing audit
entry must never abort the primary operation.

The ``log_*`` functions below write the pipeline's events, one per stage a
document passes through, from Drive discovery to the review queue. Each is
called by the code that did the work, inside its transaction where it has one,
so an event exists exactly when the stage's data does.
"""
import logging

from django.db import transaction

logger = logging.getLogger(__name__)

# actor_system labels for automated events.
DRIVE_SYNC = 'Drive Sync'
PARSER = 'Parser'
CHUNKER = 'Chunker'
CLASSIFIER = 'LLM Classifier'
PIPELINE = 'Pipeline'


def log_activity(
    document_id,
    phase,
    action,
    *,
    summary='',
    actor_user=None,
    actor_system='',
    metadata=None,
):
    """Create one DocumentActivityLog row.

    Parameters
    ----------
    document_id : UUID or str
        The Document primary key.
    phase : str
        One of DocumentActivityLog.PHASE_CHOICES keys.
    action : str
        One of the ACT_* constants or a free-form verb string.
    summary : str
        Human-readable sentence shown in the activity timeline.
    actor_user : User instance or None
        Populated for user-driven events; None for automated phases.
    actor_system : str
        Label such as ``"Drive Sync"`` or ``"LLM Classifier"`` for automated events.
    metadata : dict or None
        Structured details (counts, diffs, paragraph ids, etc.).
    """
    try:
        from document_pipeline.models import DocumentActivityLog
        # A savepoint: when the caller is inside a transaction, a failed insert
        # rolls back only itself instead of breaking the caller's writes.
        with transaction.atomic():
            DocumentActivityLog.objects.create(
                document_id=document_id,
                phase=phase,
                action=action,
                summary=summary,
                actor_user=actor_user,
                actor_system=actor_system,
                metadata=metadata or {},
            )
    except Exception:
        logger.exception(
            'Failed to create activity log for document %s action %s',
            document_id, action,
        )


# ---------------------------------------------------------------------------
# Pipeline events
# ---------------------------------------------------------------------------

def _log():
    from document_pipeline.models import DocumentActivityLog
    return DocumentActivityLog


def _iso(value):
    return value.isoformat() if value else None


def _size(num_bytes):
    if num_bytes is None:
        return 'a file of unknown size'
    if num_bytes < 1024:
        return '%d bytes' % num_bytes
    if num_bytes < 1024 * 1024:
        return '%.1f KB' % (num_bytes / 1024)
    return '%.1f MB' % (num_bytes / (1024 * 1024))


def _plural(count, word):
    return '%d %s%s' % (count, word, '' if count == 1 else 's')


def _already_logged(document_id, action, classification_run_id):
    """True when this run's event is already on record. Guards the events a
    retried Celery task would otherwise write a second time."""
    return _log().objects.filter(
        document_id=document_id, action=action,
        metadata__classification_run_id=str(classification_run_id),
    ).exists()


def log_drive_discovered(document):
    """A Drive file seen for the first time became a Document."""
    A = _log()
    log_activity(
        document.id, A.DATA_INGESTION, A.ACT_DRIVE_DISCOVERED,
        summary='Found "%s" in Google Drive.' % document.name,
        actor_system=DRIVE_SYNC,
        metadata={
            'drive_file_id': document.source_external_id,
            'file_name': document.name,
            'mime_type': document.mime_type or None,
            'size_bytes': document.file_size_bytes,
            'folder_id': document.source_parent_id or None,
            'drive_modified_time': _iso(document.source_modified_time),
        },
    )


def log_pipeline_queued(document_id, task_id, *, classify):
    """A sync handed the document's pipeline to Celery. What stops a second
    sync from queuing it again while this one is still running."""
    A = _log()
    log_activity(
        document_id, A.DATA_INGESTION, A.ACT_PIPELINE_QUEUED,
        summary='Queued for parsing, chunking%s.' % (' and classification' if classify else ''),
        actor_system=DRIVE_SYNC,
        metadata={'task_id': task_id, 'classify': classify},
    )


def log_parsing_started(document):
    from django.conf import settings
    A = _log()
    log_activity(
        document.id, A.DATA_PARSING, A.ACT_PARSING_STARTED,
        summary='Parsing started.',
        actor_system=PARSER,
        metadata={
            'drive_file_id': document.source_external_id,
            'parser_build': settings.PARSER_BUILD,
        },
    )


def log_parse_result(document, run, result, *, persist_ms):
    """The download (when bytes were fetched) and the outcome of one new
    ExtractionRun: parsed, rejected or failed."""
    from document_pipeline.parsing.result import FAILED, REJECTED
    A = _log()
    source = result.source or {}
    timings = result.timings_ms or {}

    download_ms = timings.get('download')
    if download_ms:
        log_activity(
            document.id, A.DATA_STAGING, A.ACT_DOWNLOAD_STAGED,
            summary='Downloaded %s from Google Drive in %d ms.'
                    % (_size(source.get('file_size_bytes')), download_ms),
            actor_system=PARSER,
            metadata={
                'extraction_run_id': str(run.id),
                'drive_file_id': source.get('drive_file_id'),
                'size_bytes': source.get('file_size_bytes'),
                'mime_type': source.get('mime_type'),
                'content_sha256': source.get('content_sha256'),
                'download_ms': download_ms,
            },
        )

    base = {
        'extraction_run_id': str(run.id),
        'attempt': run.attempt,
        'status': run.status,
        'parser_build': run.parser_build,
    }
    rejection = result.rejection or {}
    if result.status in (REJECTED, FAILED):
        rejected = result.status == REJECTED
        reason = rejection.get('reason') or 'no reason given'
        log_activity(
            document.id, A.DATA_PARSING,
            A.ACT_PARSING_REJECTED if rejected else A.ACT_PARSING_FAILED,
            summary=('Not parsed: %s' if rejected else 'Parsing failed: %s') % reason,
            actor_system=PARSER,
            metadata={
                **base,
                'reason': reason,
                'detected_format': rejection.get('detected_format'),
                'remedy': rejection.get('remedy'),
            },
        )
        return

    warnings = result.warnings or []
    summary = 'Parsed %s and %s across %s.' % (
        _plural(run.clause_count, 'clause'), _plural(run.paragraph_count, 'paragraph'),
        _plural(run.page_count, 'page'))
    if warnings:
        summary = summary[:-1] + ', with %s.' % _plural(len(warnings), 'warning')
    log_activity(
        document.id, A.DATA_PARSING, A.ACT_PARSED,
        summary=summary,
        actor_system=PARSER,
        metadata={
            **base,
            'clauses': run.clause_count,
            'paragraphs': run.paragraph_count,
            'page_count': run.page_count,
            'warnings': len(warnings),
            'warning_codes': run.warning_codes,
            'parse_ms': timings.get('parse'),
            'persist_ms': persist_ms,
        },
    )


def log_parsing_skipped(document, run):
    """The file's bytes and the parser are unchanged, so nothing was re-written."""
    A = _log()
    log_activity(
        document.id, A.DATA_PARSING, A.ACT_PARSING_SKIPPED,
        summary='Unchanged since the last parse; nothing re-written.',
        actor_system=PARSER,
        metadata={'extraction_run_id': str(run.id), 'attempt': run.attempt},
    )


def log_parsing_error(document, exc):
    """The download or the write raised, so no run was recorded."""
    A = _log()
    log_activity(
        document.id, A.DATA_PARSING, A.ACT_PARSING_FAILED,
        summary='Parsing failed: %s' % exc,
        actor_system=PARSER,
        metadata={'error': type(exc).__name__, 'reason': str(exc)},
    )


def log_chunking_started(extraction_run, attempt, chunker_version):
    A = _log()
    log_activity(
        extraction_run.document_id, A.DATA_PARSING, A.ACT_CHUNKING_STARTED,
        summary='Chunking started.',
        actor_system=CHUNKER,
        metadata={
            'extraction_run_id': str(extraction_run.id),
            'attempt': attempt,
            'chunker_version': chunker_version,
        },
    )


def log_chunked(chunk_run, chunks, duration_ms):
    """`chunks` are the Chunk rows written. The token figure is the estimate
    the classifier batches by, over the micro chunks it will read."""
    from document_pipeline.classification.batching import estimate_tokens
    A = _log()
    stats = chunk_run.stats or {}
    unreachable = len(stats.get('clauses_unreachable') or [])
    missing = len(stats.get('paragraphs_missing') or [])
    tokens = sum(estimate_tokens(c.text) for c in chunks if c.kind == 'micro')
    summary = 'Chunked into %s and %s (about %d tokens).' % (
        _plural(chunk_run.micro_count, 'micro chunk'),
        _plural(chunk_run.macro_count, 'macro chunk'), tokens)
    if not chunk_run.is_complete:
        summary += ' Coverage gap: %s unreachable, %s missing.' % (
            _plural(unreachable, 'clause'), _plural(missing, 'paragraph'))
    log_activity(
        chunk_run.document_id, A.DATA_PARSING, A.ACT_CHUNKED,
        summary=summary,
        actor_system=CHUNKER,
        metadata={
            'chunk_run_id': str(chunk_run.id),
            'extraction_run_id': str(chunk_run.extraction_run_id),
            'attempt': chunk_run.attempt,
            'chunker_version': chunk_run.chunker_version,
            'chunks': chunk_run.chunk_count,
            'micro_chunks': chunk_run.micro_count,
            'macro_chunks': chunk_run.macro_count,
            'indexed_chunks': chunk_run.indexed_count,
            'token_estimate': tokens,
            'complete': chunk_run.is_complete,
            'clauses_unreachable': unreachable,
            'paragraphs_missing': missing,
            'duration_ms': duration_ms,
        },
    )


def log_classifying_started(run):
    """A ClassificationRun was opened."""
    A = _log()
    log_activity(
        run.document_id, A.DATA_CLASSIFICATION, A.ACT_CLASSIFYING_STARTED,
        summary='Classification started: %s with %s.'
                % (_plural(run.micro_count, 'micro chunk'), run.model_id),
        actor_system=CLASSIFIER,
        metadata={
            'classification_run_id': str(run.id),
            'attempt': run.attempt,
            'model_id': run.model_id,
            'taxonomy_version': run.taxonomy_version,
            'prompt_version': run.prompt_version,
            'micro_chunks': run.micro_count,
        },
    )


def log_classification_finished(run):
    """A ClassificationRun was closed: classified, or failed. Written once per
    run, however often the closing task is retried."""
    from django.conf import settings
    from django.db.models import Avg, Count, Q
    from document_pipeline.models import ClassificationRun
    A = _log()

    succeeded = run.status in (ClassificationRun.SUCCEEDED,
                               ClassificationRun.SUCCEEDED_WITH_WARNINGS)
    if run.status == ClassificationRun.RUNNING:
        return
    action = A.ACT_CLASSIFIED if succeeded else A.ACT_CLASSIFICATION_FAILED
    if _already_logged(run.document_id, action, run.id):
        return

    threshold = settings.CLASSIFY_CONFIDENCE_THRESHOLD
    confidence = run.classifications.aggregate(
        average=Avg('confidence'),
        low=Count('id', filter=Q(confidence__lt=threshold)),
    )
    average = confidence['average']
    metadata = {
        'classification_run_id': str(run.id),
        'attempt': run.attempt,
        'status': run.status,
        'model_id': run.model_id,
        'taxonomy_version': run.taxonomy_version,
        'prompt_version': run.prompt_version,
        'calls': run.call_count,
        'prompt_tokens': run.input_tokens,
        'completion_tokens': run.output_tokens,
        'cache_read_tokens': run.cache_read_tokens,
        'cache_write_tokens': run.cache_write_tokens,
        'micro_chunks': run.micro_count,
        'classified': run.classified_count,
        'unclassified': run.unclassified_count,
        'failed': run.failed_count,
        'needs_review': run.review_count,
        'avg_confidence': round(average, 3) if average is not None else None,
        'low_confidence': confidence['low'],
        'confidence_threshold': threshold,
        'duration_ms': run.duration_ms,
    }
    if succeeded:
        summary = 'Classified %d of %s; %d need review.' % (
            run.classified_count, _plural(run.micro_count, 'micro chunk'), run.review_count)
    else:
        summary = 'Classification failed: %s' % (run.error_detail or 'no detail recorded')
        metadata['reason'] = run.error_detail
    log_activity(run.document_id, A.DATA_CLASSIFICATION, action,
                 summary=summary, actor_system=CLASSIFIER, metadata=metadata)


def log_moved_to_review(document_id, paragraph_stats):
    """The document's review records exist and it waits for a reviewer.
    Written once per classification run."""
    from document_pipeline.models import Document
    from document_pipeline.review_views import _blockers
    from document_pipeline.services.export_service import current_classification_run
    A = _log()

    # The run of the document's current chunking. A document re-chunked keeps
    # a current run per chunk run, so "any current run" can be the old one.
    document = Document.objects.filter(pk=document_id).first()
    run = current_classification_run(document) if document else None
    run_id = str(run.id) if run else None
    if run_id and _already_logged(document_id, A.ACT_NEEDS_REVIEW, run_id):
        return
    blockers = _blockers(document_id)
    total = paragraph_stats.get('total', 0)
    flagged = paragraph_stats.get('flagged', 0)
    log_activity(
        document_id, A.DATA_CLASSIFICATION, A.ACT_NEEDS_REVIEW,
        summary='Moved to the review queue: %d of %s need review.'
                % (flagged, _plural(total, 'paragraph')),
        actor_system=PIPELINE,
        metadata={
            'classification_run_id': run_id,
            'paragraphs': total,
            'needs_review': flagged,
            'blockers_count': len(blockers),
            'blockers': blockers,
        },
    )
