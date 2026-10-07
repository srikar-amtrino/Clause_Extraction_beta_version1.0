import asyncio
import json
from datetime import timedelta
from unittest.mock import AsyncMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone

from core.models import IngestionSource, User, UserSession
from document_pipeline.models import Document, WorkspaceLock
from document_pipeline.review_views import (
    _check_editable,
    _status_when_workspace_opened,
    lock_acquire,
    lock_respond_access,
)
from document_pipeline.tasks.publish import publish_document_task
from realtime.events import publish_document_lock
from realtime.consumers.document_consumer import DocumentConsumer


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

    def test_workspace_open_transitions_review_status(self):
        self.assertEqual(_status_when_workspace_opened('needs_review'), 'in_review')
        self.assertEqual(
            _status_when_workspace_opened('published'),
            'reopened_in_review',
        )
        self.assertEqual(_status_when_workspace_opened('draft'), 'draft')


class WorkspaceAccessHandoverTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.reviewer_a = User.objects.create(
            email='reviewer-a@example.com',
            username='reviewer-a',
        )
        self.reviewer_b = User.objects.create(
            email='reviewer-b@example.com',
            username='reviewer-b',
        )
        self.other_reviewer = User.objects.create(
            email='reviewer-c@example.com',
            username='reviewer-c',
        )
        self.source = IngestionSource.objects.create(
            name='workspace-lock-test',
            source_type='test',
        )
        self.document = Document.objects.create(
            ingestion_source=self.source,
            source_external_id='workspace-lock-test',
            name='Workspace lock test',
            review_status='in_review',
            current_reviewer=self.reviewer_a,
        )
        self.lock = WorkspaceLock.objects.create(
            document=self.document,
            user=self.reviewer_a,
        )
        self.tokens = {}
        for reviewer in (self.reviewer_a, self.reviewer_b, self.other_reviewer):
            token = f'token-{reviewer.username}'
            UserSession.objects.create(
                user=reviewer,
                token=token,
                expires_at=timezone.now() + timedelta(days=1),
            )
            self.tokens[reviewer.pk] = token

    def _request(self, path, user, payload=None):
        request = self.factory.post(
            path,
            data=json.dumps(payload or {}),
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.tokens[user.pk]}',
        )
        return request

    def test_opening_by_another_user_keeps_current_reviewer_read_only(self):
        Document.objects.filter(pk=self.document.pk).update(review_status='needs_review')
        response = lock_acquire(
            self._request('/', self.reviewer_b),
            str(self.document.pk),
        )

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertTrue(payload['is_read_only'])
        self.assertEqual(payload['locked_by'], self.reviewer_a.username)
        self.document.refresh_from_db()
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_a.pk)
        self.assertEqual(self.document.review_status, 'in_review')

    @patch('realtime.events.publish_document_lock')
    def test_first_workspace_opener_becomes_current_reviewer(self, publish_lock):
        self.lock.delete()
        Document.objects.filter(
            pk=self.document.pk,
        ).update(review_status='needs_review', current_reviewer=None)

        response = lock_acquire(
            self._request('/', self.reviewer_b),
            str(self.document.pk),
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['acquired'])
        self.document.refresh_from_db()
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_b.pk)
        self.assertEqual(self.document.review_status, 'in_review')
        publish_lock.assert_called_once()

    def test_websocket_disconnect_does_not_release_workspace_lock(self):
        consumer = DocumentConsumer()
        consumer.user = self.reviewer_a
        consumer.document_id = str(self.document.pk)
        consumer.group_name = f'document_{self.document.pk}'
        consumer.channel_name = 'test-channel'
        consumer.channel_layer = Mock()
        consumer.channel_layer.group_discard = AsyncMock()

        asyncio.run(consumer.disconnect(1006))

        self.lock.refresh_from_db()
        self.document.refresh_from_db()
        self.assertEqual(self.lock.user_id, self.reviewer_a.pk)
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_a.pk)
        consumer.channel_layer.group_discard.assert_awaited_once_with(
            consumer.group_name,
            consumer.channel_name,
        )

    @patch('realtime.events.publish_document_lock')
    @patch('realtime.events.publish_access_event')
    def test_grant_transfers_lock_and_current_reviewer_atomically(
        self,
        publish_access,
        publish_lock,
    ):
        response = lock_respond_access(
            self._request(
                '/',
                self.reviewer_a,
                {'action': 'grant', 'target_user_id': str(self.reviewer_b.pk)},
            ),
            str(self.document.pk),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['status'], 'granted')
        self.lock.refresh_from_db()
        self.document.refresh_from_db()
        self.assertEqual(self.lock.user_id, self.reviewer_b.pk)
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_b.pk)
        self.assertEqual(self.document.review_status, 'in_review')
        publish_lock.assert_called_once()
        self.assertEqual(publish_lock.call_args.kwargs['event'], 'document_opened')
        self.assertEqual(publish_lock.call_args.kwargs['user'], self.reviewer_b)
        publish_access.assert_called_once()

    def test_only_current_reviewer_can_transfer_access(self):
        response = lock_respond_access(
            self._request(
                '/',
                self.other_reviewer,
                {'action': 'grant', 'target_user_id': str(self.reviewer_b.pk)},
            ),
            str(self.document.pk),
        )

        self.assertEqual(response.status_code, 403)
        self.lock.refresh_from_db()
        self.document.refresh_from_db()
        self.assertEqual(self.lock.user_id, self.reviewer_a.pk)
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_a.pk)

    @patch('realtime.events.publish_access_event')
    def test_deny_keeps_current_reviewer_and_lock(self, publish_access):
        response = lock_respond_access(
            self._request(
                '/',
                self.reviewer_a,
                {'action': 'deny', 'target_user_id': str(self.reviewer_b.pk)},
            ),
            str(self.document.pk),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['status'], 'denied')
        self.lock.refresh_from_db()
        self.document.refresh_from_db()
        self.assertEqual(self.lock.user_id, self.reviewer_a.pk)
        self.assertEqual(self.document.current_reviewer_id, self.reviewer_a.pk)
        self.assertEqual(self.document.review_status, 'in_review')
        publish_access.assert_called_once()


class PublishDocumentTaskTests(TestCase):
    def test_successful_publish_marks_extraction_and_review_status_published(self):
        reviewer = User.objects.create(
            email='publisher@example.com',
            username='publisher',
        )
        source = IngestionSource.objects.create(
            name='publish-task-test',
            source_type='test',
        )
        document = Document.objects.create(
            ingestion_source=source,
            source_external_id='publish-task-test',
            name='Publish task test',
            extraction_status='classified',
            review_status='reviewed',
            agreement_type='Stored Agreement',
            sectorial_category='Stored Sector',
        )

        with patch(
            'document_pipeline.services.review_service.deleted_paragraph_ids',
            return_value=set(),
        ), patch(
            'document_pipeline.services.embedding_service.delete_points',
            return_value=0,
        ), patch(
            'document_pipeline.services.embedding_service.embed_and_upsert',
            return_value={
                'failed': 0,
                'embedded': 0,
                'added': 0,
                'updated': 0,
                'count_after': 0,
            },
        ) as embed_and_upsert:
            result = publish_document_task.run(
                str(document.pk),
                str(reviewer.pk),
                agreement_type='Request Agreement',
                sectorial_category='Request Sector',
            )

        document.refresh_from_db()
        self.assertEqual(result['status'], 'PUBLISHED')
        self.assertEqual(document.extraction_status, 'published')
        self.assertEqual(document.review_status, 'published')
        self.assertEqual(
            embed_and_upsert.call_args.kwargs,
            {
                'agreement_type': 'Request Agreement',
                'sectorial_category': 'Request Sector',
            },
        )
