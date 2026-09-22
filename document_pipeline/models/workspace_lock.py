"""Soft lock that grants one user exclusive editing access to a document.

Only one lock may exist per document at a time. When the lock holder leaves
the workspace (or it expires), any waiting reviewer can acquire it. Users
who arrive while a lock is held are served the workspace in read-only mode
and can see which reviewer currently holds the lock.
"""
import uuid
from datetime import timedelta

from django.db import models
from django.utils import timezone


# Heartbeat TTL: the frontend renews this every 60 s.
LOCK_TTL_SECONDS = 120


def default_expiry():
    return timezone.now() + timedelta(seconds=LOCK_TTL_SECONDS)


class WorkspaceLock(models.Model):
    """Exclusive editing lock on one document.

    The lock is advisory -- it is not enforced at the DB write level --
    but every mutating view checks it before accepting a write. A lock
    whose ``expires_at`` is in the past is treated as released: the
    cleaner task will remove it, but a new acquire does not have to wait
    for that.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.OneToOneField(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='workspace_lock',
    )
    user = models.ForeignKey(
        'core.User',
        on_delete=models.CASCADE,
        related_name='workspace_locks',
    )
    locked_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=default_expiry)

    class Meta:
        db_table = 'workspace_locks'
        indexes = [
            models.Index(fields=['document'], name='wslock_doc_idx'),
            models.Index(fields=['user'], name='wslock_user_idx'),
            models.Index(fields=['expires_at'], name='wslock_expires_idx'),
        ]

    @property
    def is_active(self):
        return timezone.now() < self.expires_at

    def renew(self):
        """Extend TTL by LOCK_TTL_SECONDS from now."""
        self.expires_at = timezone.now() + timedelta(seconds=LOCK_TTL_SECONDS)
        self.save(update_fields=['expires_at'])

    def __str__(self):
        return 'Lock(%s -> %s)' % (self.document_id, self.user_id)
