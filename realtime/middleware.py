from channels.db import database_sync_to_async
from django.utils import timezone


@database_sync_to_async
def _user_for_token(token):
	from core.models import UserSession

	session = UserSession.objects.select_related('user').filter(token=token).first()
	if not session or session.expires_at <= timezone.now():
		return None
	return session.user


class TokenAuthMiddleware:
	"""Authenticate websocket clients with the session token subprotocol."""

	def __init__(self, app):
		self.app = app

	async def __call__(self, scope, receive, send):
		scope = dict(scope)
		protocols = scope.get('subprotocols', [])
		token = protocols[1] if len(protocols) > 1 and protocols[0] == 'bearer' else None
		scope['user'] = await _user_for_token(token) if token else None
		return await self.app(scope, receive, send)
