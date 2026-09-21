"""Phase 2, Step 2.3: write one ParseResult to the database.

Atomic per document, idempotent on content checksum, and append-only: every
parse attempt creates a new ExtractionRun rather than mutating the last one, so
a clause a reviewer has already ruled on is never rewritten underneath them.

Takes a ParseResult and an IngestionSource. Knows nothing about Drive, which is
what lets it be tested without credentials or network.
"""
import logging
import time
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import timedelta, timezone as dt_timezone

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from document_pipeline.models import (
    Document,
    ExtractedClause,
    ExtractedParagraph,
    ExtractionRun,
    PipelineStageLog,
)
from document_pipeline.parsing.result import (
    EXTRACTED,
    EXTRACTED_WITH_WARNINGS,
    FAILED,
    REJECTED,
)

logger = logging.getLogger(__name__)

# ParseResult.status -> PipelineStageLog.status
STAGE_STATUS = {
    EXTRACTED: 'succeeded',
    EXTRACTED_WITH_WARNINGS: 'succeeded_with_warnings',
    REJECTED: 'rejected',
    FAILED: 'failed',
}

# Clause keys that map to a column of the same name.
CLAUSE_DIRECT = (
    'level', 'assigned_depth', 'display_number', 'clause_title', 'canonical_path',
    'full_path', 'parent_path', 'is_compound_lead_in', 'bonded_to_lead_in',
    'child_count', 'descendant_count', 'sibling_index', 'sibling_count', 'is_leaf',
    'order_index', 'dfs_index', 'bfs_index', 'text', 'body_text', 'numbering_source',
    'style', 'confidence', 'conflict',
)
CLAUSE_JSON = ('lead_in_child_ids', 'ancestor_ids', 'child_ids', 'paragraph_ids', 'flags')
# Consumed by hand rather than copied, so they must not fall through to `extra`.
CLAUSE_RENAMED = ('clause_id', 'parent_id')
CLAUSE_KNOWN = frozenset(CLAUSE_DIRECT + CLAUSE_JSON + CLAUSE_RENAMED)

PARAGRAPH_DIRECT = (
    'sequence_order', 'text', 'page_number', 'source_paragraph_index', 'segment_index',
    'bucket', 'container', 'is_clause_start', 'numbering_source', 'confidence',
)
PARAGRAPH_JSON = ('breadcrumbs', 'flags')
PARAGRAPH_RENAMED = ('paragraph_id', 'clause_id', 'table_position')
PARAGRAPH_KNOWN = frozenset(PARAGRAPH_DIRECT + PARAGRAPH_JSON + PARAGRAPH_RENAMED)


@dataclass
class PersistOutcome:
    document: Document
    run: ExtractionRun | None
    created: bool = False           # the Document row was new
    skipped: bool = False           # unchanged since the current run; nothing written
    clause_count: int = 0
    paragraph_count: int = 0
    issues: list[str] = field(default_factory=list)


def _as_dict(record):
    """Paragraph records arrive as dataclasses from the parser and as plain
    dicts from a rehydrated fixture. Normalise without losing unknown keys."""
    if is_dataclass(record) and not isinstance(record, type):
        return {f.name: getattr(record, f.name) for f in fields(record)}
    return dict(record)


def _dt(value):
    """Drive timestamps and ParseResult.extracted_at are ISO strings."""
    if not value:
        return None
    if not isinstance(value, str):
        return value
    parsed = parse_datetime(value)
    if parsed and timezone.is_naive(parsed):
        parsed = parsed.replace(tzinfo=dt_timezone.utc)
    return parsed


def _elapsed_ms(started):
    return int((time.perf_counter() - started) * 1000)


def persist_parse_result(result, *, ingestion_source, force=False, store_raw=None):
    """Write one ParseResult durably. -> PersistOutcome

    Rejected and failed results are persisted too: a document that could not be
    parsed still has to be visible, with its reason, in the review dashboard.
    """
    print('[persistence] writing %s' % (result.source or {}).get('drive_file_id', ''), flush=True)
    if store_raw is None:
        store_raw = settings.PARSE_STORE_RAW_RESULT
    started = time.perf_counter()
    source = result.source or {}
    external_id = source.get('drive_file_id') or ''
    if not external_id:
        raise ValueError('ParseResult.source has no drive_file_id; cannot identify the document.')

    issues = []

    with transaction.atomic():
        document, created = Document.objects.get_or_create(
            ingestion_source=ingestion_source,
            source_external_id=external_id,
            defaults={'name': source.get('name') or result.document_name or ''},
        )
        # Serialise concurrent parses of the same file so the partial unique
        # index on is_current never has to be the thing that stops them.
        # A no-op on SQLite, which is what the test suite runs on.
        document = Document.objects.select_for_update().get(pk=document.pk)

        current = document.extraction_runs.filter(is_current=True).first()
        if not force and _unchanged(current, result, source):
            return PersistOutcome(document=document, run=current, created=created,
                                  skipped=True,
                                  clause_count=current.clause_count,
                                  paragraph_count=current.paragraph_count)

        previous = document.extraction_runs.order_by('-attempt').first()
        attempt = (previous.attempt + 1) if previous else 1
        document.extraction_runs.filter(is_current=True).update(is_current=False)

        run = _create_run(document, result, source, attempt, store_raw)
        clauses, by_local = _build_clauses(run, result.clauses, issues)
        ExtractedClause.objects.bulk_create(clauses,
                                            batch_size=settings.PERSIST_BULK_BATCH_SIZE)
        paragraphs = _build_paragraphs(run, result.paragraphs, by_local, issues)
        ExtractedParagraph.objects.bulk_create(paragraphs,
                                               batch_size=settings.PERSIST_BULK_BATCH_SIZE)

        duration_ms = _elapsed_ms(started)
        PipelineStageLog.objects.bulk_create(
            _build_stage_logs(document, run, result, attempt, duration_ms))

        run.persist_duration_ms = duration_ms
        run.save(update_fields=['persist_duration_ms'])

        _update_document(document, result, source, run)

    logger.info('persisted %s: run %s attempt %d, %d clauses, %d paragraphs',
                external_id, run.id, run.attempt, len(clauses), len(paragraphs))
    return PersistOutcome(document=document, run=run, created=created, skipped=False,
                          clause_count=len(clauses), paragraph_count=len(paragraphs),
                          issues=issues)


def _unchanged(current, result, source):
    """True when re-persisting would produce the same rows we already have.

    Four conditions, each load-bearing: same bytes, same output shape, same
    parser behaviour, and a last attempt that actually worked -- otherwise a
    transient failure would be cached forever.
    """
    sha = source.get('content_sha256')
    return bool(
        current is not None
        and sha
        and current.content_sha256 == sha
        and current.schema_version == result.schema_version
        and current.parser_build == settings.PARSER_BUILD
        and current.is_usable
    )


def _create_run(document, result, source, attempt, store_raw):
    stats = result.stats or {}
    warnings = result.warnings or []
    return ExtractionRun.objects.create(
        document=document,
        attempt=attempt,
        is_current=True,
        status=result.status,
        schema_version=result.schema_version,
        parser_build=settings.PARSER_BUILD,
        document_name=result.document_name or '',
        document_title=result.document_title,
        extracted_at=_dt(result.extracted_at) or timezone.now(),
        content_sha256=source.get('content_sha256') or '',
        md5_checksum=source.get('md5_checksum') or '',
        file_size_bytes=source.get('file_size_bytes'),
        source_modified_time=_dt(source.get('modified_time')),
        rejection=result.rejection,
        warnings=warnings,
        warning_codes=[w.get('code') for w in warnings if w.get('code')],
        has_warnings=bool(warnings),
        stats=stats,
        timings_ms=result.timings_ms or {},
        source=source,
        raw_result=result.to_dict() if store_raw else None,
        clause_count=len(result.clauses),
        paragraph_count=len(result.paragraphs),
        max_level=stats.get('max_level') or 0,
        flagged_clause_count=stats.get('flagged_clauses') or 0,
        conflict_count=stats.get('conflicts') or 0,
        page_count=stats.get('page_count') or 0,
    )


def _build_clauses(run, rows, issues):
    """One pass, no follow-up UPDATE: pks are generated client-side and a
    parent always precedes its children in order_index."""
    by_local = {}
    built = []
    for row in sorted(rows, key=lambda r: r['order_index']):
        local_id = row['clause_id']
        parent = None
        parent_local = row.get('parent_id')
        if parent_local:
            parent = by_local.get(parent_local)
            if parent is None:
                # A malformed tree should degrade to a flat one, not abort a
                # write of several hundred good rows.
                issues.append('clause %s: parent %s not seen yet, attached at root'
                              % (local_id, parent_local))
        flags = row.get('flags') or []
        clause = ExtractedClause(
            run=run,
            local_id=local_id,
            parent=parent,
            has_flags=bool(flags),
            extra={k: v for k, v in row.items() if k not in CLAUSE_KNOWN},
            **{k: row.get(k) for k in CLAUSE_DIRECT},
            **{k: (row.get(k) or []) for k in CLAUSE_JSON},
        )
        by_local[local_id] = clause
        built.append(clause)
    return built, by_local


def _build_paragraphs(run, records, by_local, issues):
    built = []
    for record in records:
        row = _as_dict(record)
        clause = None
        clause_local = row.get('clause_id')
        if clause_local:
            clause = by_local.get(clause_local)
            if clause is None:
                issues.append('paragraph %s: clause %s not found'
                              % (row.get('paragraph_id'), clause_local))
        built.append(ExtractedParagraph(
            run=run,
            clause=clause,
            local_id=row.get('paragraph_id') or '',
            table_position=row.get('table_position'),
            extra={k: v for k, v in row.items() if k not in PARAGRAPH_KNOWN},
            **{k: row.get(k) for k in PARAGRAPH_DIRECT},
            **{k: (row.get(k) or []) for k in PARAGRAPH_JSON},
        ))
    return built


def _build_stage_logs(document, run, result, attempt, persist_ms):
    """One row per stage the parser reported a timing for, plus the write
    itself. Iterating timings_ms rather than naming its keys means a stage
    added later logs itself with no change here.

    Only `persist` gets wall-clock timestamps: for download and parse the
    parser reports a duration but not when it started.
    """
    stage_status = STAGE_STATUS.get(result.status, 'failed')
    rejection = result.rejection or {}
    logs = []
    for stage, duration in (result.timings_ms or {}).items():
        is_download = stage == 'download'
        logs.append(PipelineStageLog(
            document=document, extraction_run=run, stage=stage, attempt=attempt,
            # A download that produced bytes succeeded even if the parse failed.
            status='succeeded' if is_download else stage_status,
            duration_ms=duration,
            error_code='' if is_download else rejection.get('detected_format', ''),
            error_detail='' if is_download else rejection.get('reason', ''),
            payload={} if is_download else {'warnings': result.warnings or []},
        ))
    if not result.timings_ms:
        # Rejected before download: no timings at all, but the attempt still
        # has to appear in the document's history with its reason.
        logs.append(PipelineStageLog(
            document=document, extraction_run=run, stage='parse', attempt=attempt,
            status=stage_status,
            error_code=rejection.get('detected_format', ''),
            error_detail=rejection.get('reason', ''),
        ))
    finished = timezone.now()
    logs.append(PipelineStageLog(
        document=document, extraction_run=run, stage='persist', attempt=attempt,
        status='succeeded', duration_ms=persist_ms,
        started_at=finished - timedelta(milliseconds=persist_ms), finished_at=finished,
        payload={'clauses': run.clause_count, 'paragraphs': run.paragraph_count},
    ))
    return logs


def _update_document(document, result, source, run):
    document.name = source.get('name') or result.document_name or document.name
    document.document_title = result.document_title
    document.mime_type = source.get('mime_type') or ''
    document.drive_web_link = source.get('drive_web_link') or ''
    document.file_size_bytes = source.get('file_size_bytes')
    document.source_modified_time = _dt(source.get('modified_time'))
    document.extraction_status = run.status
    document.last_extracted_at = run.extracted_at
    document.save(update_fields=[
        'name', 'document_title', 'mime_type', 'drive_web_link', 'file_size_bytes',
        'source_modified_time', 'extraction_status', 'last_extracted_at', 'updated_at',
    ])
