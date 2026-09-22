"""Canonical Postgres copy of one paragraph after classification.

When the classification run completes, the finalize task materialises a
row here for every micro-chunk. This table is the source of truth for
the review workspace: the frontend reads from here, not from the raw
Classification or ExtractedParagraph tables. On first publish all rows
are embedded; on re-publish only rows where is_modified=True are
re-embedded.
"""
import uuid

from django.db import models


class DocumentParagraphRecord(models.Model):
    """Live review-workspace record for one paragraph / micro-chunk.

    One row per (document, paragraph_id). The row is created by the
    finalize task and updated in-place by the reviewer. ``original_text``
    is never changed after creation; ``reviewed_text`` holds the human
    edit (or a copy of original when no edit has been made).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='paragraph_records',
    )
    # The chunk/paragraph this row mirrors, kept for cross-referencing.
    chunk = models.ForeignKey(
        'document_pipeline.Chunk',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='paragraph_records',
    )
    classification = models.ForeignKey(
        'document_pipeline.Classification',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='paragraph_records',
    )

    # ---- Identity ----------------------------------------------------------
    # e.g. "P-026". Local to the document; not globally unique.
    paragraph_id = models.CharField(max_length=64)
    # Hierarchical section path, e.g. ["1. Definitions", "1.1"]
    breadcrumb = models.JSONField(default=list, blank=True)
    source_page = models.PositiveIntegerField(default=1)
    sequence_order = models.PositiveIntegerField(default=0)

    # ---- Text --------------------------------------------------------------
    original_text = models.TextField()
    reviewed_text = models.TextField()

    # ---- Classification ----------------------------------------------------
    CLAUSE = 'Clause'
    NON_CLAUSE = 'Non-clause'
    LABEL_CHOICES = [(CLAUSE, CLAUSE), (NON_CLAUSE, NON_CLAUSE)]

    label = models.CharField(max_length=16, choices=LABEL_CHOICES, default=CLAUSE)
    canonical_type = models.CharField(max_length=255, blank=True, default='')
    sub_type = models.CharField(max_length=255, blank=True, default='')
    confidence = models.FloatField(null=True, blank=True)
    # Issues/flags raised by the LLM: list of reason strings.
    llm_issues = models.JSONField(default=list, blank=True)

    # ---- Review state ------------------------------------------------------
    is_reviewed = models.BooleanField(default=False)
    # Set whenever reviewed_text, label, canonical_type, or sub_type changes
    # after first publish. Drives differential embed on re-publish.
    is_modified = models.BooleanField(default=False)

    reviewed_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reviewed_paragraphs',
    )
    last_edited_by = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='edited_paragraphs',
    )
    last_edited_at = models.DateTimeField(null=True, blank=True)

    # ---- Vector sync -------------------------------------------------------
    # Null until first publish; updated on every sync.
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # The vector DB record id for this paragraph (e.g. Pinecone/pgvector id).
    vector_id = models.CharField(max_length=255, blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'document_paragraph_records'
        constraints = [
            models.UniqueConstraint(
                fields=['document', 'paragraph_id'],
                name='unique_paragraph_per_document',
            ),
        ]
        indexes = [
            models.Index(fields=['document', 'sequence_order'],
                         name='dpr_doc_seq_idx'),
            models.Index(fields=['document', 'is_reviewed'],
                         name='dpr_doc_reviewed_idx'),
            models.Index(fields=['document', 'is_modified'],
                         name='dpr_doc_modified_idx'),
        ]
        ordering = ['sequence_order']

    def __str__(self):
        return '%s / %s' % (self.document_id, self.paragraph_id)
