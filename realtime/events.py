import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def publish_document_lock(document_id, *, event, user, expires_at=None):
    payload = {
        'event': event,
        'document_id': str(document_id),
        'locked': event == 'document_opened',
        'locked_by': user.username if event == 'document_opened' else None,
        'locked_by_id': str(user.pk) if event == 'document_opened' else None,
        'closed_by': user.username if event == 'document_closed' else None,
        'closed_by_id': str(user.pk) if event == 'document_closed' else None,
    }
    if expires_at:
        payload['expires_at'] = expires_at.isoformat()

    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'document_{document_id}',
                {'type': 'document_lock_update', 'payload': payload},
            )
    except Exception:
        logger.exception('Failed to publish document lock event: %s', event)


def publish_access_event(document_id, *, event, user, target_user=None):
    """Publish access request lifecycle events:
    - access_requested: a reader is asking the current editor for access
    - access_granted: the editor relinquished edit lock for the requester
    - access_denied: the editor declined the handover request
    """
    payload = {
        'event': event,
        'document_id': str(document_id),
        'requested_by': user.username if event == 'access_requested' else (target_user.username if target_user else None),
        'requested_by_id': str(user.pk) if event == 'access_requested' else (str(target_user.pk) if target_user else None),
        'actor': user.username,
        'actor_id': str(user.pk),
        'target_user': target_user.username if target_user else None,
        'target_user_id': str(target_user.pk) if target_user else None,
    }
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'document_{document_id}',
                {'type': 'document_lock_update', 'payload': payload},
            )
    except Exception:
        logger.exception('Failed to publish access event: %s', event)