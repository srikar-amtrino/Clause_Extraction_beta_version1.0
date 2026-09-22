import uuid

from django.db import models

from .user import User


class UserSession(models.Model):
    """One row per active login session.

    The ``token`` is a 64-hex cryptographically secure random string issued on
    signup or login and sent back as ``Authorization: Bearer <token>``.  Every
    authenticated request looks this table up and checks ``expires_at``.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='sessions',
    )
    token = models.CharField(max_length=128, unique=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    # Absolute expiry — compared against timezone.now() on every request.
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    # Updated automatically on every successful token validation.
    last_activity = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'user_sessions'
        indexes = [
            models.Index(fields=['token']),
            models.Index(fields=['user', 'expires_at']),
        ]
        ordering = ['-created_at']

    def __str__(self):
        return f'Session({self.user.email}, expires={self.expires_at.date()})'
