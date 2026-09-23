"""Collaborative, document-level plain-text note.

One note per document, any reviewer can update it. The latest version
wins; no revision history is kept here (the activity log captures who
changed what).
"""
import uuid

from django.db import models


class DocumentNote(models.Model):
    """Free-text note attached to one document.

    GET returns the current text. POST/PUT replaces it and records the
    action in DocumentActivityLog.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.OneToOneField(
        'document_pipeline.Document',
        on_delete=models.CASCADE,
        related_name='note',
    )
    author = models.ForeignKey(
        'core.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='document_notes',
    )
    text = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'document_notes'

    def __str__(self):
        return 'Note(%s)' % self.document_id
