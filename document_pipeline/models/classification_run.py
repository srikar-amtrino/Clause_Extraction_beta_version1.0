"""One classification pass over one chunk run."""
import uuid

from django.db import models
from django.db.models import Q


class ClassificationRun(models.Model):
    """One classification attempt. Append-only, like ExtractionRun and ChunkRun.

    A run is written `running` and not current, fills in batch by batch, and is
    promoted to current only when finalized. The check constraint makes that a
    database fact: a reader filtering on is_current can never see a run that is
    half written or that failed. A re-run creates a new attempt; the old one
    stays readable, so a review already made against it is never rewritten.

    The run records everything that decided its answers -- taxonomy version,
    prompt version, model, and the system prompt exactly as sent -- so a
    verdict can be explained long after the prompt in code has moved on.
    """

    RUNNING = 'running'
    SUCCEEDED = 'succeeded'
    SUCCEEDED_WITH_WARNINGS = 'succeeded_with_warnings'
    FAILED = 'failed'
    STATUS_CHOICES = [
        (RUNNING, RUNNING),
        (SUCCEEDED, SUCCEEDED),
        (SUCCEEDED_WITH_WARNINGS, SUCCEEDED_WITH_WARNINGS),
        (FAILED, FAILED),
    ]
    FINISHED_OK = (SUCCEEDED, SUCCEEDED_WITH_WARNINGS)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chunk_run = models.ForeignKey('document_pipeline.ChunkRun', on_delete=models.CASCADE,
                                  related_name='classification_runs')
    # Denormalised from chunk_run.extraction_run.document: the review queue
    # asks "current classification of this document" and should not need three
    # joins to answer it.
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='classification_runs')
    attempt = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=False)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=RUNNING)

    # What decided the answers. A run whose three identity fields match the
    # current configuration is up to date; any change warrants a new attempt.
    taxonomy_version = models.CharField(max_length=16)
    prompt_version = models.CharField(max_length=16)
    model_id = models.CharField(max_length=255)
    bedrock_client = models.CharField(max_length=16)
    system_prompt = models.TextField(blank=True, default='')
    system_prompt_sha256 = models.CharField(max_length=64, blank=True, default='')
    params = models.JSONField(default=dict, blank=True)
    stats = models.JSONField(default=dict, blank=True)

    # Denormalised from the rows at finalize so listing needs no aggregation.
    micro_count = models.PositiveIntegerField(default=0)
    classified_count = models.PositiveIntegerField(default=0)
    unclassified_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    review_count = models.PositiveIntegerField(default=0)
    call_count = models.PositiveIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_read_tokens = models.PositiveIntegerField(default=0)
    cache_write_tokens = models.PositiveIntegerField(default=0)

    started_at = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    error_detail = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'classification_runs'
        constraints = [
            models.UniqueConstraint(fields=['chunk_run', 'attempt'],
                                    name='unique_classification_run_attempt'),
            models.UniqueConstraint(fields=['chunk_run'], condition=Q(is_current=True),
                                    name='unique_current_classification_run'),
            models.CheckConstraint(
                condition=Q(is_current=False) | Q(status__in=['succeeded', 'succeeded_with_warnings']),
                name='current_classification_run_finished'),
        ]
        indexes = [
            models.Index(fields=['document', '-created_at'], name='classrun_doc_created_idx'),
            models.Index(fields=['status'], name='classrun_status_idx'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return '%s attempt %d (%s)' % (self.chunk_run_id, self.attempt, self.status)
