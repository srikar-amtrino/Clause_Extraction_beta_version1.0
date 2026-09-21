"""One immutable parse attempt for one document."""
import uuid

from django.db import models
from django.db.models import Q


class ExtractionRun(models.Model):
    """One parse attempt. Append-only: never updated except to clear is_current.

    Clauses and paragraphs hang off the run rather than the document, so a
    re-parse never mutates rows an existing verdict points at. A stale verdict
    stays readable and is visibly stale (its run is no longer current) instead
    of being silently rewritten.

    `is_current` means "most recent attempt, whatever happened" -- rejected and
    failed runs carry it too, so the dashboard can show why a document has no
    clauses. Callers wanting good data filter on `is_usable`.
    """

    EXTRACTED = 'extracted'
    EXTRACTED_WITH_WARNINGS = 'extracted_with_warnings'
    REJECTED = 'rejected'
    FAILED = 'failed'

    STATUS_CHOICES = [
        (EXTRACTED, EXTRACTED),
        (EXTRACTED_WITH_WARNINGS, EXTRACTED_WITH_WARNINGS),
        (REJECTED, REJECTED),
        (FAILED, FAILED),
    ]
    USABLE = (EXTRACTED, EXTRACTED_WITH_WARNINGS)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='extraction_runs')
    attempt = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES)

    # Parser identity. schema_version only moves when the output shape changes,
    # so parser_build is what distinguishes a re-parse after a bug fix.
    schema_version = models.CharField(max_length=16)
    parser_build = models.CharField(max_length=64, blank=True, default='')

    document_name = models.CharField(max_length=500)
    document_title = models.CharField(max_length=500, null=True, blank=True)
    extracted_at = models.DateTimeField()

    # Source fidelity. md5_checksum and source_modified_time are stored now so
    # the sync path can skip the download itself later without a migration.
    content_sha256 = models.CharField(max_length=64, blank=True, default='')
    md5_checksum = models.CharField(max_length=32, blank=True, default='')
    file_size_bytes = models.BigIntegerField(null=True, blank=True)
    source_modified_time = models.DateTimeField(null=True, blank=True)

    # Canonical home for the rejection reason: "every failed document with its
    # reason" must be one indexed query, not a subquery over stage logs.
    rejection = models.JSONField(null=True, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    warning_codes = models.JSONField(default=list, blank=True)
    has_warnings = models.BooleanField(default=False)

    stats = models.JSONField(default=dict, blank=True)
    timings_ms = models.JSONField(default=dict, blank=True)
    source = models.JSONField(default=dict, blank=True)
    # Verbatim ParseResult.to_dict(), written once. Gated on
    # settings.PARSE_STORE_RAW_RESULT.
    raw_result = models.JSONField(null=True, blank=True)

    # Denormalized from stats so listing and sorting need no JSON access.
    clause_count = models.PositiveIntegerField(default=0)
    paragraph_count = models.PositiveIntegerField(default=0)
    max_level = models.PositiveIntegerField(default=0)
    flagged_clause_count = models.PositiveIntegerField(default=0)
    conflict_count = models.PositiveIntegerField(default=0)
    page_count = models.PositiveIntegerField(default=0)

    persist_duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'extraction_runs'
        constraints = [
            models.UniqueConstraint(fields=['document', 'attempt'],
                                    name='unique_extraction_run_attempt'),
            # Partial unique index: two current runs for one document are
            # impossible at the database level, not merely discouraged.
            models.UniqueConstraint(fields=['document'], condition=Q(is_current=True),
                                    name='unique_current_extraction_run'),
        ]
        indexes = [
            models.Index(fields=['document', '-created_at'], name='run_doc_created_idx'),
            models.Index(fields=['status'], name='run_status_idx'),
            models.Index(fields=['content_sha256'], name='run_sha256_idx'),
        ]
        ordering = ['-created_at']

    @property
    def is_usable(self):
        return self.status in self.USABLE

    def __str__(self):
        return '%s attempt %d (%s)' % (self.document_name, self.attempt, self.status)
