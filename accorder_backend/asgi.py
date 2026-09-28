import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'accorder_backend.settings.development')

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from channels.security.websocket import AllowedHostsOriginValidator

from realtime.middleware import TokenAuthMiddleware
from realtime.routing import websocket_urlpatterns


django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
	'http': django_asgi_app,
	'websocket': AllowedHostsOriginValidator(
		TokenAuthMiddleware(URLRouter(websocket_urlpatterns))
	),
})
