"""Phase 2, Step 2.4: turn a set of Drive files into parsed, persisted documents.

Two separable halves, deliberately not fused:

  sync_drive_files()  reconciles what Drive currently holds against the Document
                      table. Metadata only -- no downloads, so it is fast enough
                      to run inside a web request.
    ingest_document()   downloads and parses one document. Slow, so it is driven
                                            from a Celery task rather than a request.

Splitting them is what lets the sync endpoint stay responsive over a folder of
any size while Celery handles the slow work in parsing workers.
"""
import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import IngestionSource
from document_pipeline.models import Document
from document_pipeline.parsing.result import SCHEMA_VERSION
from document_pipeline.services.drive_service import (
    DriveFile,
    DriveFileRejected,
    validate_for_parsing,
)
from document_pipeline.services.parse_service import rejected_result, stream_and_parse
from document_pipeline.services.persistence_service import persist_parse_result

logger = logging.getLogger(__name__)

GOOGLE_DRIVE = 'Google Drive'
DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


def google_drive_source():
    """The IngestionSource row every Drive-sourced document points at.

    get_or_create rather than a data migration: the row is a fact about how the
    pipeline is wired, not reference data a human curates, and seeding it lazily
    keeps a fresh database working with no setup step.
    """
    source, _ = IngestionSource.objects.get_or_create(
        name=GOOGLE_DRIVE,
        defaults={'source_type': 'google_drive',
                  'description': 'Documents ingested from Google Drive.'},
    )
    return source


@dataclass
class SyncOutcome:
    """What one reconciliation changed. Lists hold Documents, not Drive dicts,
    so callers can act on them without a second lookup."""
    created: list = field(default_factory=list)
    renamed: list = field(default_factory=list)
    updated: list = field(default_factory=list)
    moved: list = field(default_factory=list)
    restored: list = field(default_factory=list)
    deleted: list = field(default_factory=list)
    unchanged: int = 0

    @property
    def changed(self):
        return (self.created + self.renamed + self.updated
                + self.moved + self.restored + self.deleted)


def _int_or_none(value):
    """Drive reports size as a string, and omits it for native Google files."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def sync_drive_files(files, *, ingestion_source, folder_ids=()):
    """Reconcile a flattened Drive file map against the Document table.

    `files` is {drive_file_id: {id, name, mimeType, modifiedTime, size,
    parent_id}} -- exactly what the picker's folder walk produces.

    The database is the snapshot. The previous implementation diffed against a
    copy held in the Django session, which meant a new browser saw every file as
    new and two people syncing the same folder disagreed.

    Deletion is scoped to `folder_ids`: a file missing from a folder we walked
    is gone, but a document belonging to a folder nobody asked about is left
    alone.
    """
    from document_pipeline.pipeline_logger import (
        log_deduplication_decision,
        log_deduplication_summary,
    )

    print('[ingestion] reconciling %d Drive files' % len(files), flush=True)
    outcome = SyncOutcome()
    scope = set(folder_ids) | {meta.get('parent_id') for meta in files.values()}
    scope.discard(None)

    with transaction.atomic():
        all_docs = list(
            Document.objects.select_for_update()
            .filter(ingestion_source=ingestion_source)
        )
        existing = {d.source_external_id: d for d in all_docs}
        # Secondary index: active docs by (name, parent_id) to catch re-uploads / duplicates
        existing_by_name = {
            (d.name, d.source_parent_id): d
            for d in all_docs
            if d.deleted_at is None
        }

        for file_id, meta in files.items():
            name = meta.get('name') or ''
            parent = meta.get('parent_id') or ''
            document = existing.get(file_id)

            if document is None:
                # Check if this file was re-uploaded to Drive under the same name and folder
                duplicate_match = existing_by_name.get((name, parent))
                if duplicate_match is not None:
                    # Update external ID rather than creating a duplicate row
                    old_id = duplicate_match.source_external_id
                    duplicate_match.source_external_id = file_id
                    _reconcile(duplicate_match, meta, outcome)
                    # Ensure it is treated as updated for ingestion if mtime changed
                    if duplicate_match not in outcome.updated and duplicate_match not in outcome.renamed:
                        outcome.updated.append(duplicate_match)
                    log_deduplication_decision(
                        "DEDUPLICATED (REPLACED)",
                        name,
                        file_id,
                        parent,
                        str(duplicate_match.id),
                        f"Matched existing document '{name}' (ID: {duplicate_match.id}). Replaced old Drive ID '{old_id}' with '{file_id}'. Duplicate prevented!",
                    )
                    continue

                # Truly new file
                new_doc = _create_document(ingestion_source, file_id, meta)
                outcome.created.append(new_doc)
                existing[file_id] = new_doc
                existing_by_name[(name, parent)] = new_doc
                log_deduplication_decision(
                    "CREATED",
                    name,
                    file_id,
                    parent,
                    str(new_doc.id),
                    "New document registered in database.",
                )
                continue

            _reconcile(document, meta, outcome)

        for file_id, document in existing.items():
            if file_id in files or document.deleted_at is not None:
                continue
            # Only a folder we actually looked in can tell us a file is gone.
            if document.source_parent_id and document.source_parent_id not in scope:
                continue
            document.deleted_at = timezone.now()
            document.save(update_fields=['deleted_at', 'updated_at'])
            outcome.deleted.append(document)
            log_deduplication_decision(
                "SOFT-DELETED",
                document.name,
                file_id,
                document.source_parent_id,
                str(document.id),
                "File no longer present in Google Drive folder snapshot.",
            )

    log_deduplication_summary(
        outcome.created, outcome.updated, outcome.renamed,
        outcome.restored, outcome.deleted, outcome.unchanged
    )
    logger.info('drive sync: %d created, %d updated, %d deleted, %d unchanged',
                len(outcome.created), len(outcome.updated) + len(outcome.renamed),
                len(outcome.deleted), outcome.unchanged)
    print(
        '[ingestion] sync complete: created=%d updated=%d restored=%d deleted=%d'
        % (len(outcome.created), len(outcome.updated), len(outcome.restored),
           len(outcome.deleted)),
        flush=True,
    )
    return outcome


def _create_document(ingestion_source, file_id, meta):
    return Document.objects.create(
        ingestion_source=ingestion_source,
        source_external_id=file_id,
        source_parent_id=meta.get('parent_id') or '',
        name=meta.get('name') or '',
        mime_type=meta.get('mimeType') or '',
        file_size_bytes=_int_or_none(meta.get('size')),
        source_modified_time=parse_datetime(meta.get('modifiedTime') or '') or None,
    )


def _reconcile(document, meta, outcome):
    """Classify what changed about a file we already know about.

    A rename is not a content change: the name is updated but the document is
    not queued for re-parsing, because its bytes are identical.
    """
    name = meta.get('name') or ''
    parent = meta.get('parent_id') or ''
    modified = parse_datetime(meta.get('modifiedTime') or '') or None

    bucket = None
    if document.deleted_at is not None:
        document.deleted_at = None
        bucket = outcome.restored
    elif name != document.name:
        bucket = outcome.renamed
    elif modified != document.source_modified_time:
        bucket = outcome.updated
    elif parent != document.source_parent_id:
        bucket = outcome.moved

    if bucket is None:
        outcome.unchanged += 1
        return

    document.name = name
    document.source_parent_id = parent
    document.source_modified_time = modified
    document.mime_type = meta.get('mimeType') or ''
    document.file_size_bytes = _int_or_none(meta.get('size'))
    document.save(update_fields=[
        'name', 'source_parent_id', 'source_modified_time', 'mime_type',
        'file_size_bytes', 'deleted_at', 'updated_at',
    ])
    bucket.append(document)


def needs_extraction(document):
    """True when parsing this document would tell us something new.

    Uses Drive's modified time against the current run, so an unchanged folder
    re-syncs with no downloads at all. This is a cheap pre-filter, not the
    authority -- persist_parse_result re-checks the content hash, so a document
    whose mtime moved but whose bytes did not still writes no new run.

    A run from another parser build or output schema is stale even when the
    file is not: without this, a parser fix never reaches an unchanged corpus.
    """
    if document.deleted_at is not None:
        return False
    run = document.current_run
    if run is None or not run.is_usable:
        return True
    if run.parser_build != settings.PARSER_BUILD or run.schema_version != SCHEMA_VERSION:
        return True
    if document.source_modified_time and run.source_modified_time:
        return document.source_modified_time > run.source_modified_time
    return False


def pending_documents(ingestion_source, *, include_unparseable=False):
    """Documents worth handing to ingest_document(), newest activity first."""
    queryset = Document.objects.filter(ingestion_source=ingestion_source,
                                       deleted_at__isnull=True)
    if not include_unparseable:
        # A non-.docx would only be rejected again, and rejection is sticky:
        # the file has to change before the answer could differ.
        queryset = queryset.exclude(extraction_status='rejected')
    return [d for d in queryset if needs_extraction(d)]


def _drive_file(document):
    """The Drive metadata the last sync stored, in the worker's shape."""
    modified = document.source_modified_time
    return DriveFile(
        id=document.source_external_id,
        name=document.name,
        mime_type=document.mime_type,
        size_bytes=document.file_size_bytes,
        md5_checksum=None,
        web_view_link=document.drive_web_link or None,
        modified_time=modified.isoformat() if modified else None,
    )


def dispatch_rejection(document):
    """Why this document must not be queued, or None. -> DriveFileRejected | None

    Judged from the synced metadata by the rule the streaming worker applies to
    live metadata, so the dispatcher never queues a file the worker would
    refuse, and never holds back one it would accept.
    """
    if not document.mime_type:
        # Nothing but the name to go on. The worker re-checks against Drive
        # before downloading, so giving a .docx name the benefit is safe.
        if document.name.lower().endswith('.docx'):
            return None
        return DriveFileRejected('Drive reported no type and the name is not .docx',
                                 'not_docx_mime_type')
    try:
        validate_for_parsing(_drive_file(document), settings.PARSE_MAX_FILE_BYTES)
    except DriveFileRejected as exc:
        return exc
    return None


def record_rejection(document, rejection):
    """Persist a dispatcher refusal exactly as a worker refusal is persisted:
    a rejected ExtractionRun holding the reason, a stage log, and
    extraction_status 'rejected'. -> PersistOutcome"""
    return persist_parse_result(rejected_result(_drive_file(document), rejection),
                                ingestion_source=document.ingestion_source)


@dataclass
class DispatchPlan:
    """What a sync hands to Celery, and what it refused. `rejected` holds
    (Document, DriveFileRejected) pairs."""
    to_ingest: list = field(default_factory=list)
    rejected: list = field(default_factory=list)


def _due(document):
    """True when an accepted, unchanged document still needs a parse."""
    if document.extraction_status == 'rejected':
        # Sticky, as in pending_documents: refused bytes are refused again until
        # the file changes. A document with no run at all was refused by its
        # name alone, before any worker looked at it, so it gets that look now.
        return not document.extraction_runs.exists()
    return needs_extraction(document)


def plan_dispatch(documents, changed_ids):
    """Split synced documents into those to queue and those refused, recording
    each refusal. -> DispatchPlan

    A refusal is recorded once per version of the file. persist_parse_result
    never treats a rejected run as unchanged, so recording it on every sync
    would append a new rejected run each time.
    """
    plan = DispatchPlan()
    for document in documents:
        changed = document.id in changed_ids
        rejection = dispatch_rejection(document)
        if rejection is None:
            if changed or _due(document):
                plan.to_ingest.append(document)
            continue
        if (changed or document.extraction_status != 'rejected'
                or not document.extraction_runs.exists()):
            print('[ingestion] not queued %s (%s): %s'
                  % (document.name, rejection.kind, rejection), flush=True)
            record_rejection(document, rejection)
        plan.rejected.append((document, rejection))
    return plan


def ingest_document(credentials, document, *, force=False):
    """Download, parse and persist one document. -> PersistOutcome"""
    print('[ingestion] downloading and parsing %s' % document.source_external_id, flush=True)
    result = stream_and_parse(credentials, document.source_external_id)
    outcome = persist_parse_result(result,
                                   ingestion_source=document.ingestion_source,
                                   force=force)
    print('[ingestion] persisted %s' % document.source_external_id, flush=True)
    return outcome
