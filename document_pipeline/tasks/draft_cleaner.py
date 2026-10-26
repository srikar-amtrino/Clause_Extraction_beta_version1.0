"""Beat task: purge expired 24-hour review drafts.

Runs on the default queue every hour. Discards ReviewDraft rows whose
``expires_at`` has passed without the reviewer saving. The document
review_status transitions back from ``draft`` to its pre-draft state
(``in_review`` or ``reopened_in_review``) so it stays visible in the
queue.
"""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(queue='default', acks_late=True)
def purge_expired_drafts_task():
    """Delete expired ReviewDraft rows and revert document statuses."""
    from document_pipeline.models import Document, DocumentActivityLog, ReviewDraft
    from document_pipeline.activity import log_activity

    expired = ReviewDraft.objects.filter(expires_at__lte=timezone.now())
    count = 0

    for draft in expired.select_related('document'):
        doc = draft.document

        # Revert review_status from draft back to in_review / reopened_in_review.
        if doc.review_status == 'draft':
            revert_to = (
                'reopened_in_review'
                if doc.review_status.startswith('reopened')
                else 'in_review'
            )
            Document.objects.filter(pk=doc.pk).update(review_status=revert_to)

        log_activity(
            document_id=doc.pk,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=DocumentActivityLog.ACT_DRAFT_EXPIRED,
            summary='Unsaved draft discarded after 24 h.',
            actor_system='Draft Cleaner',
            metadata={'user_id': str(draft.user_id)},
        )

        draft.delete()
        count += 1

    if count:
        logger.info('purge_expired_drafts_task: discarded %d expired draft(s)', count)

    return {'discarded': count}
