"""One source paragraph of one extraction run."""
import uuid

from django.db import models


class ExtractedParagraph(models.Model):
    """A non-empty source paragraph, in reading order.

    `clause` is built from the parser's own paragraph.clause_id, NOT from
    clause.paragraph_ids. The two disagree: paragraph_ids carries only node and
    body paragraphs, so table cells inherit a clause_id but are never listed
    back (24 of 226 paragraphs in the MSA sample). Using paragraph_ids as the
    edge silently orphans every table cell.

    `text` is the clean source text and is never rewritten.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey('document_pipeline.ExtractionRun', on_delete=models.CASCADE,
                            related_name='paragraphs')
    # SET_NULL because a paragraph can legitimately belong to no clause
    # (front matter, removed intro), and losing the paragraph would lose text.
    clause = models.ForeignKey('document_pipeline.ExtractedClause', on_delete=models.SET_NULL,
                               null=True, blank=True, related_name='paragraph_rows')

    sequence_order = models.PositiveIntegerField()
    local_id = models.CharField(max_length=32)
    text = models.TextField(blank=True, default='')
    page_number = models.PositiveIntegerField(default=1)
    source_paragraph_index = models.PositiveIntegerField()
    segment_index = models.PositiveIntegerField(default=0)
    bucket = models.CharField(max_length=32)
    container = models.CharField(max_length=32)
    is_clause_start = models.BooleanField(default=False)
    numbering_source = models.CharField(max_length=64, null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)

    breadcrumbs = models.JSONField(default=list, blank=True)
    table_position = models.JSONField(null=True, blank=True)
    flags = models.JSONField(default=list, blank=True)
    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'extracted_paragraphs'
        constraints = [
            models.UniqueConstraint(fields=['run', 'sequence_order'], name='unique_para_sequence'),
            models.UniqueConstraint(fields=['run', 'source_paragraph_index'],
                                    name='unique_para_source_index'),
        ]
        indexes = [
            models.Index(fields=['run', 'sequence_order'], name='para_run_seq_idx'),
            # The hottest review-UI query: the text behind one clause.
            models.Index(fields=['clause', 'sequence_order'], name='para_clause_seq_idx'),
            models.Index(fields=['run', 'page_number'], name='para_run_page_idx'),
            models.Index(fields=['run', 'bucket'], name='para_run_bucket_idx'),
        ]
        ordering = ['sequence_order']

    def __str__(self):
        return self.local_id
