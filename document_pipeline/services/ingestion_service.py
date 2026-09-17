"""Phase 2, Step 2.4: turn a set of Drive files into parsed, persisted documents.

Two separable halves, deliberately not fused:

  sync_drive_files()  reconciles what Drive currently holds against the Document
                      table. Metadata only -- no downloads, so it is fast enough
                      to run inside a web request.
  ingest_document()   downloads and parses one document. Slow, so it is driven
                      from a management command rather than a request.

Splitting them is what lets the sync endpoint stay responsive over a folder of
any size without a task queue.
"""
import logging
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from core.models import IngestionSource
from document_pipeline.models import Document
from document_pipeline.services.parse_service import stream_and_parse
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
    outcome = SyncOutcome()
    scope = set(folder_ids) | {meta.get('parent_id') for meta in files.values()}
    scope.discard(None)

    with transaction.atomic():
        existing = {d.source_external_id: d for d in
                    Document.objects.select_for_update()
                    .filter(ingestion_source=ingestion_source)}

        for file_id, meta in files.items():
            document = existing.get(file_id)
            if document is None:
                outcome.created.append(_create_document(ingestion_source, file_id, meta))
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

    logger.info('drive sync: %d created, %d updated, %d deleted, %d unchanged',
                len(outcome.created), len(outcome.updated) + len(outcome.renamed),
                len(outcome.deleted), outcome.unchanged)
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
    """
    if document.deleted_at is not None:
        return False
    run = document.current_run
    if run is None or not run.is_usable:
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


def ingest_document(credentials, document, *, force=False):
    """Download, parse and persist one document. -> PersistOutcome"""
    result = stream_and_parse(credentials, document.source_external_id)
    return persist_parse_result(result,
                                ingestion_source=document.ingestion_source,
                                force=force)
