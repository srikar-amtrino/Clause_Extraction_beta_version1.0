import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction

logger = logging.getLogger(__name__)


@database_sync_to_async
def _document_exists(document_id):
	from document_pipeline.models import Document

	return Document.objects.filter(pk=document_id).exists()


@database_sync_to_async
def _active_lock_state(document_id):
	"""Return the current lock state, auto-clearing expired locks."""
	from document_pipeline.models import Document, WorkspaceLock

	lock = (
		WorkspaceLock.objects.select_related('user')
		.filter(document_id=document_id)
		.first()
	)
	if not lock:
		return {'locked': False, 'locked_by': None, 'locked_by_id': None}
	if not lock.is_active:
		# Auto-cleanup expired lock
		lock.delete()
		Document.objects.filter(pk=document_id).update(current_reviewer=None)
		return {'locked': False, 'locked_by': None, 'locked_by_id': None}
	return {
		'locked': True,
		'locked_by': lock.user.username,
		'locked_by_id': str(lock.user_id),
		'expires_at': lock.expires_at.isoformat(),
	}


@database_sync_to_async
def _release_document_lock(document_id, user):
	from document_pipeline.activity import log_activity
	from document_pipeline.models import Document, DocumentActivityLog, WorkspaceLock

	with transaction.atomic():
		document = Document.objects.select_for_update().filter(pk=document_id).first()
		if not document:
			return None
		lock = WorkspaceLock.objects.select_related('user').filter(
			document_id=document_id, user_id=user.pk).first()
		if not lock:
			return None

		lock.delete()
		Document.objects.filter(pk=document_id).update(current_reviewer=None)

	log_activity(
		document_id=document_id,
		phase=DocumentActivityLog.USER_INTERACTION,
		action=DocumentActivityLog.ACT_LOCK_RELEASED,
		summary=f'{user.username} closed the workspace.',
		actor_user=user,
	)
	return {'username': user.username, 'user_id': str(user.pk)}


@database_sync_to_async
def _release_lock_on_disconnect(document_id, user):
	"""Release the lock when the WebSocket connection drops unexpectedly.

	Only releases if this user currently holds the lock. Silently returns
	None if someone else holds it (read-only visitor disconnecting).
	"""
	from document_pipeline.activity import log_activity
	from document_pipeline.models import Document, DocumentActivityLog, WorkspaceLock

	with transaction.atomic():
		document = Document.objects.select_for_update().filter(pk=document_id).first()
		if not document:
			return None
		lock = WorkspaceLock.objects.select_related('user').filter(
			document_id=document_id, user_id=user.pk).first()
		if not lock:
			# This user was a read-only visitor — nothing to release.
			return None

		lock.delete()
		Document.objects.filter(pk=document_id).update(current_reviewer=None)

	log_activity(
		document_id=document_id,
		phase=DocumentActivityLog.USER_INTERACTION,
		action=DocumentActivityLog.ACT_LOCK_RELEASED,
		summary=f'{user.username} disconnected — workspace lock auto-released.',
		actor_user=user,
	)
	return {'username': user.username, 'user_id': str(user.pk)}


class DocumentConsumer(AsyncJsonWebsocketConsumer):
	async def connect(self):
		self.user = self.scope.get('user')
		self.document_id = self.scope['url_route']['kwargs']['document_id']
		self._lock_released = False  # guard against double-release

		if not self.user or not await _document_exists(self.document_id):
			await self.close(code=4401 if not self.user else 4404)
			return

		self.group_name = f'document_{self.document_id}'
		try:
			await self.channel_layer.group_add(self.group_name, self.channel_name)
		except Exception:
			logger.warning(
				'Unable to join document websocket group %s',
				self.group_name,
				exc_info=True,
			)
			await self.close(code=1013)
			return
		await self.accept(subprotocol='bearer')
		await self.send_json({
			'event': 'lock_state',
			'document_id': self.document_id,
			**await _active_lock_state(self.document_id),
		})

	async def disconnect(self, close_code):
		# Auto-release the lock if this user holds it — covers tab close,
		# navigation away, or network drop. The frontend also fires a
		# close_document message on clean unload, so _lock_released guards
		# against double-releasing in that case.
		if hasattr(self, 'group_name'):
			if self.user and not self._lock_released:
				closed_by = await _release_lock_on_disconnect(
					self.document_id, self.user)
				if closed_by:
					self._lock_released = True
					try:
						await self.channel_layer.group_send(
							self.group_name,
							{
								'type': 'document_lock_update',
								'payload': {
									'event': 'document_closed',
									'document_id': self.document_id,
									'locked': False,
									'locked_by': None,
									'locked_by_id': None,
									'closed_by': closed_by['username'],
									'closed_by_id': closed_by['user_id'],
								},
							},
						)
					except Exception:
						logger.warning(
							'Could not broadcast disconnect lock-release for %s',
							self.document_id,
							exc_info=True,
						)
			await self.channel_layer.group_discard(self.group_name, self.channel_name)

	async def receive_json(self, content, **kwargs):
		event = content.get('event')
		if event == 'close_document':
			if self._lock_released:
				# Already released via disconnect — nothing to do.
				return

			closed_by = await _release_document_lock(self.document_id, self.user)
			if not closed_by:
				await self.send_json({'event': 'close_denied', 'document_id': self.document_id})
				return

			self._lock_released = True
			await self.channel_layer.group_send(
				self.group_name,
				{
					'type': 'document_lock_update',
					'payload': {
						'event': 'document_closed',
						'document_id': self.document_id,
						'locked': False,
						'locked_by': None,
						'locked_by_id': None,
						'closed_by': closed_by['username'],
						'closed_by_id': closed_by['user_id'],
					},
				},
			)
			return

		if event == 'request_access':
			await self.channel_layer.group_send(
				self.group_name,
				{
					'type': 'document_lock_update',
					'payload': {
						'event': 'access_requested',
						'document_id': self.document_id,
						'requested_by': self.user.username,
						'requested_by_id': str(self.user.pk),
					},
				},
			)
			return

		if event == 'grant_access':
			closed_by = await _release_document_lock(self.document_id, self.user)
			await self.channel_layer.group_send(
				self.group_name,
				{
					'type': 'document_lock_update',
					'payload': {
						'event': 'access_granted',
						'document_id': self.document_id,
						'granted_by': self.user.username,
						'target_user': content.get('target_user'),
						'target_user_id': str(content.get('target_user_id') or ''),
					},
				},
			)
			return

		if event == 'deny_access':
			await self.channel_layer.group_send(
				self.group_name,
				{
					'type': 'document_lock_update',
					'payload': {
						'event': 'access_denied',
						'document_id': self.document_id,
						'denied_by': self.user.username,
						'target_user': content.get('target_user'),
						'target_user_id': str(content.get('target_user_id') or ''),
					},
				},
			)
			return

	async def document_lock_update(self, event):
		await self.send_json(event['payload'])

	async def document_status_update(self, event):
		await self.send_json({
			'event': event.get('event'),
			'document_id': event.get('document_id'),
		})
