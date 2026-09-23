"""Document-wise, 5-phase activity log.

Every event that touches a document -- from Drive fetch through user
interaction -- gets a row here. The log is append-only and never
updated. The 5 phases map directly to the frontend timeline view.
"""
import uuid

from django.db import models


class DocumentActivityLog(models.Model):
    """One event in a document lifetime.

    ``phase`` partitions the timeline into the 5 pipeline stages.
    ``actor_user`` is null for automated events (Celery workers); for those,
    ``actor_system`` carries a human-readable label such as
    "Drive Sync" or "LLM Classifier".

    ``metadata`` holds structured details: counts, before/after diffs,
    paragraph ids affected, etc.
    """

    # --- Phases ---
    DATA_INGESTION = 'data_ingestion'
    DATA_STAGING = 'data_staging'
    DATA_PARSING = 'data_parsing'
    DATA_CLASSIFICATION = 'data_classification'
    USER_INTERACTION = 'user_interaction'
    PHASE_CHOICES = [
        (DATA_INGESTION, 'Data Ingestion'),
        (DATA_STAGING, 'Data Staging'),
        (DATA_PARSING, 'Data Parsing'),
        (DATA_CLASSIFICATION, 'Data Classification'),
        (USER_INTERACTION, 'User Interaction'),
    ]

    # --- Actions (non-exhaustive; stored verbatim too) ---
    # Pipeline actions
    ACT_FETCHED = 'fetched_from_drive'
    ACT_STAGED = 'staged'
    ACT_PARSED = 'parsed'
    ACT_CLASSIFIED = 'classified'
    ACT_NEEDS_REVIEW = 'moved_to_review_queue'
    # User actions
    ACT_OPENED = 'opened_workspace'
    ACT_LOCK_ACQUIRED = 'acquired_lock'
    ACT_LOCK_RELEASED = 'released_lock'
    ACT_LOCK_EXPIRED = 'lock_expired'
    ACT_PARA_EDITED = 'modified_paragraph_text'
    ACT_TYPE_CHANGED = 'changed_canonical_type'
    ACT_MARKED_REVIEWED = 'marked_paragraphs_reviewed'
    ACT_DRAFT_SAVED = 'saved_draft'
    ACT_DRAFT_DISCARDED = 'discarded_draft'
    ACT_DRAFT_EXPIRED = 'draft_expired'
    ACT_SAVED = 'saved_review'
    ACT_PUBLISHED = 'published_to_vector_db'
    ACT_REOPENED = 'reopened_published_document'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='activity_logs',
    )
    phase = models.CharField(max_length=32, choices=PHASE_CHOICES)
    action = models.CharField(max_length=64)

    # Exactly one of these should be set.
    actor_user = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='document_activity',
    )
    actor_system = models.CharField(max_length=128, blank=True, default='')

    # Human-readable sentence shown in the timeline, e.g.
    # "Modified text on P-026" or "Classified 338 chunks (Taxonomy v1)"
    summary = models.TextField(blank=True, default='')

    # Structured payload: before/after values, counts, paragraph ids, etc.
    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'document_activity_logs'
        indexes = [
            models.Index(fields=['document', '-created_at'],
                         name='actlog_doc_created_idx'),
            models.Index(fields=['document', 'phase'],
                         name='actlog_doc_phase_idx'),
            models.Index(fields=['actor_user', '-created_at'],
                         name='actlog_user_created_idx'),
            models.Index(fields=['-created_at'],
                         name='actlog_created_idx'),
        ]
        ordering = ['-created_at']

    def __str__(self):
        actor = (self.actor_user_id or self.actor_system) or 'system'
        return '[%s] %s by %s' % (self.phase, self.action, actor)
