"""Record of one Vector DB sync for a document.

Created when a reviewer publishes (first time) or re-publishes (diff)
a document. Stores counts so the document detail panel can show
"39 records synced" and the history panel can show the full sync log.
"""
import uuid

from django.db import models


class VectorSyncRun(models.Model):
    """One embed + publish pass for a document.

    ``is_differential`` is False for the first publish (all paragraphs
    embedded) and True for every subsequent sync (only modified paragraphs
    re-embedded). ``records_embedded`` counts only the rows actually sent
    to the embedding model in this run.
    """

    SUCCEEDED = 'succeeded'
    FAILED = 'failed'
    ROLLED_BACK = 'rolled_back'
    STATUS_CHOICES = [
        (SUCCEEDED, 'Succeeded'),
        (FAILED, 'Failed'),
        (ROLLED_BACK, 'Rolled back'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='vector_sync_runs',
    )
    triggered_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='vector_sync_runs',
    )
    is_differential = models.BooleanField(default=False)
    records_total = models.PositiveIntegerField(default=0)
    records_embedded = models.PositiveIntegerField(default=0)
    records_unchanged = models.PositiveIntegerField(default=0)
    records_failed = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES,
                              default=SUCCEEDED)
    error_detail = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = 'vector_sync_runs'
        indexes = [
            models.Index(fields=['document', '-started_at'],
                         name='vsync_doc_started_idx'),
        ]
        ordering = ['-started_at']

    def __str__(self):
        kind = 'diff' if self.is_differential else 'full'
        return '%s %s (%s)' % (self.document_id, kind, self.status)
