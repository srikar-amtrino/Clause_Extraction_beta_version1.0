import json
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from document_pipeline.review_views import _check_editable
from realtime.events import publish_document_lock


class WorkspaceLockTests(SimpleTestCase):
    def test_only_lock_owner_may_edit(self):
        owner = Mock(id='owner-id')
        lock = Mock(user_id='owner-id', user=Mock(username='reviewer-a'))

        with patch('document_pipeline.review_views._get_lock', return_value=lock):
            allowed, response = _check_editable('document-id', owner)
            self.assertTrue(allowed)
            self.assertIsNone(response)

            denied, response = _check_editable(
                'document-id', Mock(id='other-id'))

        self.assertFalse(denied)
        self.assertEqual(response.status_code, 423)
        self.assertIn('reviewer-a', json.loads(response.content)['detail'])

    def test_close_event_is_published_to_document_group(self):
        channel_layer = Mock()
        user = Mock(username='reviewer-a', pk='owner-id')
        with patch('realtime.events.get_channel_layer', return_value=channel_layer), \
                patch('realtime.events.async_to_sync') as async_to_sync:
            send = Mock()
            async_to_sync.return_value = send
            publish_document_lock(
                'document-id', event='document_closed', user=user)

        async_to_sync.assert_called_once_with(channel_layer.group_send)
        send.assert_called_once_with(
            'document_document-id',
            {
                'type': 'document_lock_update',
                'payload': {
                    'event': 'document_closed',
                    'document_id': 'document-id',
                    'locked': False,
                    'locked_by': None,
                    'locked_by_id': None,
                    'closed_by': 'reviewer-a',
                    'closed_by_id': 'owner-id',
                },
            },
        )
