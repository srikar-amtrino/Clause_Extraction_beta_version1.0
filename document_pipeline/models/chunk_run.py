"""One chunking pass over one extraction run."""
import uuid

from django.db import models
from django.db.models import Q


class ChunkRun(models.Model):
    """One chunking attempt. Append-only, exactly like ExtractionRun.

    Chunks hang off a run of their own rather than directly off the extraction
    run for two reasons. The chunker emits coverage gates that prove a verdict
    can be traced back to source paragraphs, and those have to be stored
    somewhere that is not `extraction_runs`, which is a table about parsing.
    And re-chunking a parse under new rules must not delete chunks that a
    classification or an embedding already points at.

    A re-parse needs no help from this: it creates a new ExtractionRun, so its
    chunks are new rows and the old run's chunks are untouched either way.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    extraction_run = models.ForeignKey('document_pipeline.ExtractionRun',
                                       on_delete=models.CASCADE,
                                       related_name='chunk_runs')
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='chunk_runs')
    attempt = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)

    # chunk_schema_version moves only when the chunk shape changes;
    # chunker_version is what distinguishes a re-chunk after a rule change.
    chunker_version = models.CharField(max_length=16, blank=True, default='')
    chunk_schema_version = models.CharField(max_length=16)
    params = models.JSONField(default=dict, blank=True)

    stats = models.JSONField(default=dict, blank=True)

    # Denormalized from stats so listing and sorting need no JSON access.
    chunk_count = models.PositiveIntegerField(default=0)
    macro_count = models.PositiveIntegerField(default=0)
    micro_count = models.PositiveIntegerField(default=0)
    indexed_count = models.PositiveIntegerField(default=0)

    # The integrity gates, surfaced as indexable columns: "every chunk run that
    # lost a paragraph" must be one query, not a JSON scan.
    all_clauses_covered = models.BooleanField(default=False)
    all_clauses_retrievable = models.BooleanField(default=False)
    all_paragraphs_covered = models.BooleanField(default=False)

    chunked_at = models.DateTimeField()
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'chunk_runs'
        constraints = [
            models.UniqueConstraint(fields=['extraction_run', 'attempt'],
                                    name='unique_chunk_run_attempt'),
            # Two current chunk runs for one extraction run are impossible at
            # the database level, not merely discouraged.
            models.UniqueConstraint(fields=['extraction_run'], condition=Q(is_current=True),
                                    name='unique_current_chunk_run'),
        ]
        indexes = [
            models.Index(fields=['extraction_run', '-created_at'], name='chunkrun_run_created_idx'),
            models.Index(fields=['chunker_version'], name='chunkrun_version_idx'),
        ]
        ordering = ['-created_at']

    @property
    def is_complete(self):
        """Every clause chunked, every clause reachable by search, no paragraph
        dropped. Anything else needs a human before it is indexed."""
        return (self.all_clauses_covered and self.all_clauses_retrievable
                and self.all_paragraphs_covered)

    def __str__(self):
        return '%s attempt %d (%d chunks)' % (self.extraction_run_id, self.attempt,
                                              self.chunk_count)
