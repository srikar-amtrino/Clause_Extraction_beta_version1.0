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