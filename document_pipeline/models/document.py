"""One source file we have attempted to parse."""
import uuid

from django.db import models


class Document(models.Model):
    """A file we have attempted to parse, identified by where it came from.

    Identity is (ingestion_source, source_external_id) -- deliberately the same
    shape as core.Contract's unique constraint, so the two pair obviously. For
    Google Drive, `source_external_id` is the Drive file id.

    `contract` stays null until a later phase classifies the document and can
    supply the contract type core.Contract requires. The parse path never writes
    to the contracts table: one writer per table.
    """

    EXTRACTION_STATUS_CHOICES = [
        ('pending', 'pending'),
        ('extracted', 'extracted'),
        ('extracted_with_warnings', 'extracted_with_warnings'),
        ('rejected', 'rejected'),
        ('failed', 'failed'),
    ]

    # Review lifecycle: set by the finalize task and updated by workspace views.
    REVIEW_STATUS_CHOICES = [
        ('pending_classification', 'Pending Classification'),
        ('needs_review', 'Needs Review'),
        ('in_review', 'In Review'),
        ('draft', 'Draft'),
        ('reviewed', 'Reviewed'),
        ('published', 'Published'),
        ('reopened_in_review', 'Re-opened (In Review)'),
        ('reopened_reviewed', 'Re-opened (Reviewed)'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    contract = models.ForeignKey('core.Contract', on_delete=models.SET_NULL,
                                 null=True, blank=True, related_name='documents')
    ingestion_source = models.ForeignKey('core.IngestionSource', on_delete=models.PROTECT,
                                         related_name='documents')
    source_external_id = models.CharField(max_length=500)
    # The folder the file was found in. Scopes a sync to the folders actually
    # walked: without it, syncing one folder would mark every document in every
    # other folder as deleted.
    source_parent_id = models.CharField(max_length=500, blank=True, default='')

    name = models.CharField(max_length=500)
    document_title = models.CharField(max_length=500, null=True, blank=True)
    mime_type = models.CharField(max_length=255, blank=True, default='')
    drive_web_link = models.URLField(max_length=1000, blank=True, default='')
    file_size_bytes = models.BigIntegerField(null=True, blank=True)
    source_modified_time = models.DateTimeField(null=True, blank=True)

    # Mirrors the current run's status so the document list needs no join.
    extraction_status = models.CharField(max_length=32, choices=EXTRACTION_STATUS_CHOICES,
                                         default='pending')
    last_extracted_at = models.DateTimeField(null=True, blank=True)
    # Set when the file disappears from the source. Filled by the sync path.
    deleted_at = models.DateTimeField(null=True, blank=True)

    # Review lifecycle status (see REVIEW_STATUS_CHOICES). Set to
    # 'needs_review' by the finalize task once classification succeeds.
    review_status = models.CharField(
        max_length=32,
        choices=REVIEW_STATUS_CHOICES,
        default='pending_classification',
    )
    # The user currently holding the soft workspace lock (denormalised from
    # WorkspaceLock for cheap list-view queries -- avoid the extra join).
    current_reviewer = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='documents_under_review',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'documents'
        constraints = [
            models.UniqueConstraint(fields=['ingestion_source', 'source_external_id'],
                                    name='unique_document_source_external_id'),
        ]
        indexes = [
            models.Index(fields=['extraction_status'], name='doc_extract_status_idx'),
            models.Index(fields=['review_status'], name='doc_review_status_idx'),
            models.Index(fields=['ingestion_source', 'source_external_id'],
                         name='doc_source_ext_idx'),
            models.Index(fields=['contract'], name='doc_contract_idx'),
            models.Index(fields=['source_parent_id'], name='doc_parent_idx'),
            models.Index(fields=['-created_at'], name='doc_created_idx'),
        ]
        ordering = ['-created_at']

    @property
    def current_run(self):
        return self.extraction_runs.filter(is_current=True).first()

    def __str__(self):
        return self.name
