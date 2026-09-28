from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer


@database_sync_to_async
def _document_exists(document_id):
	from document_pipeline.models import Document

	return Document.objects.filter(pk=document_id).exists()


@database_sync_to_async
def _active_lock_state(document_id):
	from document_pipeline.models import WorkspaceLock

	lock = (
		WorkspaceLock.objects.select_related('user')
		.filter(document_id=document_id)
		.first()
	)
	if not lock or not lock.is_active:
		return {'locked': False, 'locked_by': None, 'locked_by_id': None}
	return {
		'locked': True,
		'locked_by': lock.user.username,
		'locked_by_id': str(lock.user_id),
		'expires_at': lock.expires_at.isoformat(),
	}


class DocumentConsumer(AsyncJsonWebsocketConsumer):
	async def connect(self):
		self.user = self.scope.get('user')
		self.document_id = self.scope['url_route']['kwargs']['document_id']
		if not self.user or not await _document_exists(self.document_id):
			await self.close(code=4401 if not self.user else 4404)
			return

		self.group_name = f'document_{self.document_id}'
		await self.channel_layer.group_add(self.group_name, self.channel_name)
		await self.accept(subprotocol='bearer')
		await self.send_json({
			'event': 'lock_state',
			'document_id': self.document_id,
			**await _active_lock_state(self.document_id),
		})

	async def disconnect(self, close_code):
		if hasattr(self, 'group_name'):
			await self.channel_layer.group_discard(self.group_name, self.channel_name)

	async def document_lock_update(self, event):
		await self.send_json(event['payload'])

	async def document_status_update(self, event):
		await self.send_json({
			'event': event.get('event'),
			'document_id': event.get('document_id'),
		})
