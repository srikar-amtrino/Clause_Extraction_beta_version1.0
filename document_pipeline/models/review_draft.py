"""24-hour autosave draft for one user on one document.

When a reviewer makes changes without explicitly saving, the frontend
POSTs a draft payload here. The draft expires 24 hours after it was
first created and is automatically discarded (not committed) by the
beat task. Only one draft per (document, user) is kept -- saving a new
one overwrites the previous.
"""
import uuid
from datetime import timedelta

from django.db import models
from django.utils import timezone


DRAFT_TTL_HOURS = 24


def default_draft_expiry():
    return timezone.now() + timedelta(hours=DRAFT_TTL_HOURS)


class ReviewDraft(models.Model):
    """Uncommitted workspace changes that expire in 24 h.

    ``draft_payload`` is a JSON snapshot of the paragraph edits the user
    has made but not saved. On expiry the beat task deletes this row and
    the workspace reverts to the last committed state (DocumentParagraphRecord).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='review_drafts',
    )
    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        related_name='review_drafts',
    )
    # Snapshot of per-paragraph edits: list of {paragraph_id, reviewed_text,
    # label, canonical_type, sub_type, is_reviewed}.
    draft_payload = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(default=default_draft_expiry)

    class Meta:
        db_table = 'review_drafts'
        constraints = [
            models.UniqueConstraint(
                fields=['document', 'user'],
                name='unique_draft_per_document_user',
            ),
        ]
        indexes = [
            models.Index(fields=['document'], name='draft_doc_idx'),
            models.Index(fields=['expires_at'], name='draft_expires_idx'),
        ]

    @property
    def seconds_remaining(self):
        delta = self.expires_at - timezone.now()
        return max(0, int(delta.total_seconds()))

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    def __str__(self):
        return 'Draft(%s / %s)' % (self.document_id, self.user_id)
