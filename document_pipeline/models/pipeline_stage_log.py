"""Append-only record of what each pipeline stage did to a document."""
import uuid

from django.db import models


class PipelineStageLog(models.Model):
    """One stage attempt, written in the same transaction as the data that
    stage produced. Never updated.

    This is the breadcrumb trail ("what happened to this document"), not
    queryable state. The rejection reason lives on ExtractionRun; the
    human-readable half is mirrored here so the timeline reads on its own.
    """

    STAGE_CHOICES = [
        ('discover', 'discover'),
        ('download', 'download'),
        ('parse', 'parse'),
        ('persist', 'persist'),
        ('chunk', 'chunk'),
        ('classify', 'classify'),
        ('embed', 'embed'),
        ('publish', 'publish'),
    ]
    STATUS_CHOICES = [
        ('started', 'started'),
        ('succeeded', 'succeeded'),
        ('succeeded_with_warnings', 'succeeded_with_warnings'),
        ('rejected', 'rejected'),
        ('failed', 'failed'),
        ('skipped', 'skipped'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='stage_logs')
    # SET_NULL so pruning old runs never erases the audit trail.
    extraction_run = models.ForeignKey('document_pipeline.ExtractionRun',
                                       on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='stage_logs')
    stage = models.CharField(max_length=32, choices=STAGE_CHOICES)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES)
    attempt = models.PositiveIntegerField(default=1)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    error_code = models.CharField(max_length=100, blank=True, default='')
    error_detail = models.TextField(blank=True, default='')
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'pipeline_stage_logs'
        indexes = [
            models.Index(fields=['document', '-created_at'], name='stagelog_doc_created_idx'),
            models.Index(fields=['stage', 'status'], name='stagelog_stage_status_idx'),
            models.Index(fields=['extraction_run'], name='stagelog_run_idx'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return '%s %s' % (self.stage, self.status)
