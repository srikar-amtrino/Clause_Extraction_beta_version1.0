"""One request to the model during a classification run."""
import uuid

from django.db import models


class ClassificationCall(models.Model):
    """What was asked, what came back, and what it cost. Never updated.

    One row per request, including retries and the halves of a split batch, so
    a run's token spend is a sum over this table and every classification can
    be traced to the exact response it came from.
    """

    SUCCEEDED = 'succeeded'
    TRUNCATED = 'truncated'      # stop_reason max_tokens; the batch is split and retried
    REFUSED = 'refused'
    INVALID = 'invalid'          # a response that did not parse or validate
    STATUS_CHOICES = [(SUCCEEDED, SUCCEEDED), (TRUNCATED, TRUNCATED),
                      (REFUSED, REFUSED), (INVALID, INVALID)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey('document_pipeline.ClassificationRun', on_delete=models.CASCADE,
                            related_name='calls')
    # Denormalised from run.document: a document's Bedrock spend is one filter.
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='classification_calls')
    batch_index = models.PositiveIntegerField()
    attempt = models.PositiveIntegerField(default=1)
    chunk_ids = models.JSONField(default=list)
    item_count = models.PositiveIntegerField(default=0)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    stop_reason = models.CharField(max_length=32, blank=True, default='')
    request_id = models.CharField(max_length=128, blank=True, default='')
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cache_read_tokens = models.PositiveIntegerField(default=0)
    cache_write_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)
    raw_output = models.TextField(blank=True, default='')
    error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'classification_calls'
        indexes = [
            models.Index(fields=['run', 'batch_index'], name='classcall_run_batch_idx'),
        ]
        ordering = ['created_at']

    def __str__(self):
        return '%s batch %d attempt %d (%s)' % (self.run_id, self.batch_index, self.attempt,
                                               self.status)
