from django.urls import re_path

from realtime.consumers.document_consumer import DocumentConsumer


websocket_urlpatterns = [
	re_path(r'^ws/documents/(?P<document_id>[0-9a-f-]+)/$', DocumentConsumer.as_asgi()),
]
