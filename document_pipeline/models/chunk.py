"""One chunk of one chunking run."""
import uuid

from django.db import models
from django.db.models import Q


class Chunk(models.Model):
    """A retrieval unit (macro) or a citation unit (micro).

    One chunk per clause, decided only by whether that clause has descendants.
    Field names match the chunker's dict except for one rename: `chunk_id` ->
    `local_id`, because it is document-local (`chunk_c14_macro` restarts in
    every document) and collides across documents. Downstream identity is the
    composite of the document and this id, never this id alone.

    Text repeats across chunks on purpose: a clause appears in its own micro
    chunk and in the macro of every ancestor. That nesting is the point.
    """

    MACRO = 'macro'
    MICRO = 'micro'
    KIND_CHOICES = [(MACRO, MACRO), (MICRO, MICRO)]

    BODY = 'body'
    EXECUTION = 'execution'
    EXHIBIT = 'exhibit'
    MIXED = 'mixed'
    REGION_CHOICES = [(BODY, BODY), (EXECUTION, EXECUTION),
                      (EXHIBIT, EXHIBIT), (MIXED, MIXED)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    chunk_run = models.ForeignKey('document_pipeline.ChunkRun', on_delete=models.CASCADE,
                                  related_name='chunks')
    # Every chunk derives from exactly one clause. CASCADE because a chunk
    # without its clause has nothing to cite.
    clause = models.ForeignKey('document_pipeline.ExtractedClause', on_delete=models.CASCADE,
                               related_name='chunks')

    local_id = models.CharField(max_length=64)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES)
    # The chunker emits in clause reading order. Row order is not guaranteed in
    # a database, so that order is stored rather than assumed -- the POC could
    # rely on JSON list position, this cannot.
    order_index = models.PositiveIntegerField()

    # A chunk is retrievable when nothing larger already contains it: every
    # macro, and a leaf only when it has no parent.
    indexed_for_retrieval = models.BooleanField(default=False)

    clause_identifier = models.CharField(max_length=64, null=True, blank=True)
    title = models.CharField(max_length=255, null=True, blank=True)
    breadcrumb = models.TextField(blank=True, default='')
    region = models.CharField(max_length=32, choices=REGION_CHOICES, default=BODY)
    regions_included = models.JSONField(default=list, blank=True)
    level = models.PositiveIntegerField()

    # The chunker's own parent_id, which is a clause local_id. Kept alongside
    # the real FK so a chunk dict rebuilt from these rows matches the parser.
    parent_local_id = models.CharField(max_length=32, null=True, blank=True)
    child_local_ids = models.JSONField(default=list, blank=True)

    is_compound_list = models.BooleanField(default=False)
    lead_in_text = models.TextField(null=True, blank=True)

    text = models.TextField(blank=True, default='')
    # "Context: <breadcrumb>\nText: <text>". Unused by the POC downstream, kept
    # so the chunk shape is complete rather than silently narrowed here.
    composite_text = models.TextField(blank=True, default='')

    # source_paragraph_index values, built from the real paragraph->clause edge
    # rather than the parser's lossy clause.paragraph_ids. This is the audit
    # trail: it is what lets a verdict name the paragraphs it came from.
    paragraph_ids = models.JSONField(default=list, blank=True)

    char_count = models.PositiveIntegerField(default=0)
    word_count = models.PositiveIntegerField(default=0)

    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'chunks'
        constraints = [
            models.UniqueConstraint(fields=['chunk_run', 'local_id'],
                                    name='unique_chunk_local_id'),
            models.UniqueConstraint(fields=['chunk_run', 'order_index'],
                                    name='unique_chunk_order'),
        ]
        indexes = [
            models.Index(fields=['chunk_run', 'order_index'], name='chunk_run_order_idx'),
            models.Index(fields=['chunk_run', 'kind'], name='chunk_run_kind_idx'),
            models.Index(fields=['clause'], name='chunk_clause_idx'),
            # The embedding stage reads exactly this slice.
            models.Index(fields=['chunk_run', 'order_index'],
                         condition=Q(indexed_for_retrieval=True),
                         name='chunk_run_indexed_idx'),
        ]
        ordering = ['order_index']

    def __str__(self):
        return self.local_id
