"""Phase 2, chunking: turn one stored ExtractionRun into Chunk rows.

Atomic per extraction run, idempotent on the chunker version, and append-only:
each pass creates a new ChunkRun rather than mutating the last one, so a chunk
a classification or an embedding already points at is never rewritten.

Reads clauses and paragraphs back out of the database rather than taking a
ParseResult, so a document parsed weeks ago can be re-chunked under new rules
without going near Drive.
"""
import logging
import time
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from document_pipeline.chunking.builder import (
    CHUNK_SCHEMA_VERSION,
    build_chunks,
)
from document_pipeline.models import (
    Chunk,
    ChunkRun,
    ExtractedClause,
    ExtractedParagraph,
    ExtractionRun,
    PipelineStageLog,
)

logger = logging.getLogger(__name__)

# Clause columns the chunker reads. Pulled explicitly so a column added later
# does not silently widen every query.
CLAUSE_FIELDS = (
    'id', 'local_id', 'parent_id', 'level', 'display_number', 'clause_title',
    'order_index', 'ancestor_ids', 'text', 'body_text', 'numbering_source',
    'is_compound_lead_in', 'paragraph_ids',
)


@dataclass
class ChunkOutcome:
    extraction_run: object
    chunk_run: ChunkRun | None
    created: bool = False           # a new ChunkRun was written
    skipped: bool = False           # already chunked at this version; nothing written
    chunk_count: int = 0
    issues: list[str] = field(default_factory=list)


def _elapsed_ms(started):
    return int((time.perf_counter() - started) * 1000)


def _clause_dicts(run):
    """Rebuild the parser's flat clause shape from stored rows.

    `parent_id` has to be the parent's local_id, not its primary key, because
    that is what the chunker's tree walk and every emitted chunk field mean by
    a parent.
    """
    rows = list(ExtractedClause.objects.filter(run=run)
                .only(*CLAUSE_FIELDS).order_by('order_index'))
    local_by_pk = {row.id: row.local_id for row in rows}
    return [{
        'clause_id': row.local_id,
        'parent_id': local_by_pk.get(row.parent_id),
        'level': row.level,
        'display_number': row.display_number,
        'clause_title': row.clause_title,
        'order_index': row.order_index,
        'ancestor_ids': row.ancestor_ids or [],
        'text': row.text,
        'body_text': row.body_text,
        'numbering_source': row.numbering_source,
        'is_compound_lead_in': row.is_compound_lead_in,
        'paragraph_ids': row.paragraph_ids or [],
    } for row in rows], {row.local_id: row.id for row in rows}


def _paragraphs_by_clause(run):
    """clause local_id -> the source paragraph indices belonging to it.

    Built from ExtractedParagraph.clause, the real edge, rather than from
    ExtractedClause.paragraph_ids. The two disagree: the clause field carries
    only node and body paragraphs, so every table cell is missing from it (24
    of 226 paragraphs in the MSA sample). Using the clause field here would
    drop those paragraphs out of the audit trail without saying so.
    """
    pairs = (ExtractedParagraph.objects
             .filter(run=run, clause__isnull=False)
             .values_list('clause__local_id', 'source_paragraph_index')
             .order_by('sequence_order'))
    out = {}
    for local_id, index in pairs:
        out.setdefault(local_id, []).append(index)
    return out


def chunk_extraction_run(run, *, force=False, chunker_version=None):
    """Chunk one stored extraction run. -> ChunkOutcome

    Only usable runs are chunkable: a rejected or failed parse has no clauses
    to chunk, and calling this on one is a caller error rather than a no-op.
    """
    if not run.is_usable:
        raise ValueError('ExtractionRun %s is %s; only a usable run can be chunked.'
                         % (run.id, run.status))

    if chunker_version is None:
        chunker_version = settings.CHUNKER_VERSION
    started = time.perf_counter()
    issues = []

    with transaction.atomic():
        # Serialise concurrent chunking of the same run so the partial unique
        # index on is_current never has to be the thing that stops them.
        # A no-op on SQLite, which is what the test suite runs on.
        ExtractionRun.objects.select_for_update().filter(pk=run.pk).first()
        current = ChunkRun.objects.filter(extraction_run=run, is_current=True).first()
        if not force and _unchanged(current, chunker_version):
            return ChunkOutcome(extraction_run=run, chunk_run=current, skipped=True,
                                chunk_count=current.chunk_count)

        clauses, pk_by_local = _clause_dicts(run)
        chunk_dicts, stats = build_chunks(clauses, _paragraphs_by_clause(run))

        previous = ChunkRun.objects.filter(extraction_run=run).order_by('-attempt').first()
        attempt = (previous.attempt + 1) if previous else 1
        ChunkRun.objects.filter(extraction_run=run, is_current=True).update(is_current=False)

        chunk_run = _create_chunk_run(run, stats, attempt, chunker_version)
        rows = _build_chunks(chunk_run, chunk_dicts, pk_by_local, issues)
        Chunk.objects.bulk_create(rows, batch_size=settings.CHUNK_BULK_BATCH_SIZE)

        duration_ms = _elapsed_ms(started)
        PipelineStageLog.objects.create(**_stage_log(run, chunk_run, attempt,
                                                     stats, duration_ms))
        chunk_run.duration_ms = duration_ms
        chunk_run.save(update_fields=['duration_ms'])

    logger.info('chunked run %s: attempt %d, %d chunks (%d macro, %d micro, %d indexed)',
                run.id, attempt, len(rows), stats['macro_chunks'],
                stats['micro_chunks'], stats['indexed_chunks'])
    if not chunk_run.is_complete:
        # A gap here means a verdict could not be traced back to its source, so
        # it is surfaced rather than left sitting in a JSON column.
        logger.warning('chunk run %s incomplete: %d unreachable clause(s), '
                       '%d missing paragraph(s)', chunk_run.id,
                       len(stats['clauses_unreachable']), len(stats['paragraphs_missing']))
    return ChunkOutcome(extraction_run=run, chunk_run=chunk_run, created=True,
                        chunk_count=len(rows), issues=issues)


def _unchanged(current, chunker_version):
    """True when re-chunking would produce the same rows we already have.

    Chunks derive deterministically from a clause tree that is itself immutable,
    so an unchanged chunker over the same run cannot produce anything new.
    """
    return bool(
        current is not None
        and current.chunker_version == chunker_version
        and current.chunk_schema_version == CHUNK_SCHEMA_VERSION
    )


def _create_chunk_run(run, stats, attempt, chunker_version):
    return ChunkRun.objects.create(
        extraction_run=run,
        document_id=run.document_id,
        attempt=attempt,
        is_current=True,
        chunker_version=chunker_version,
        chunk_schema_version=CHUNK_SCHEMA_VERSION,
        params={'paragraph_edge': 'extracted_paragraph.clause'},
        stats=stats,
        chunk_count=stats['chunk_count'],
        macro_count=stats['macro_chunks'],
        micro_count=stats['micro_chunks'],
        indexed_count=stats['indexed_chunks'],
        all_clauses_covered=stats['all_clauses_covered'],
        all_clauses_retrievable=stats['all_clauses_retrievable'],
        all_paragraphs_covered=stats['all_paragraphs_covered'],
        chunked_at=timezone.now(),
    )


def _build_chunks(chunk_run, chunk_dicts, pk_by_local, issues):
    """Chunk dicts -> unsaved Chunk rows, in emitted order."""
    rows = []
    for order_index, data in enumerate(chunk_dicts):
        clause_pk = pk_by_local.get(data['clause_id'])
        if clause_pk is None:
            # Cannot happen from build_chunks, whose clauses come from these
            # same rows. Recorded rather than raised so one bad chunk does not
            # cost the whole document.
            issues.append('chunk %s references unknown clause %s'
                          % (data['chunk_id'], data['clause_id']))
            continue
        rows.append(Chunk(
            chunk_run=chunk_run,
            document_id=chunk_run.extraction_run.document_id,
            clause_id=clause_pk,
            local_id=data['chunk_id'],
            kind=data['chunk_kind'],
            order_index=order_index,
            indexed_for_retrieval=data['indexed_for_retrieval'],
            clause_identifier=data['clause_identifier'],
            title=data['title'],
            breadcrumb=data['breadcrumb'],
            region=data['region'],
            regions_included=data['regions_included'],
            level=data['level'],
            parent_local_id=data['parent_id'],
            child_local_ids=data['child_ids'],
            is_compound_list=data['is_compound_list'],
            lead_in_text=data['lead_in_text'],
            text=data['text'],
            composite_text=data['composite_text'],
            paragraph_ids=data['paragraph_ids'],
            char_count=data['char_count'],
            word_count=data['word_count'],
        ))
    return rows


def _stage_log(run, chunk_run, attempt, stats, duration_ms):
    finished = timezone.now()
    complete = chunk_run.is_complete
    return dict(
        document_id=run.document_id, extraction_run=run, stage='chunk', attempt=attempt,
        status='succeeded' if complete else 'succeeded_with_warnings',
        duration_ms=duration_ms,
        started_at=finished - timedelta(milliseconds=duration_ms), finished_at=finished,
        error_detail='' if complete else 'coverage gap',
        payload={
            'chunks': stats['chunk_count'],
            'macro': stats['macro_chunks'],
            'micro': stats['micro_chunks'],
            'indexed': stats['indexed_chunks'],
            'clauses_unreachable': stats['clauses_unreachable'],
            'paragraphs_missing': stats['paragraphs_missing'],
        },
    )
