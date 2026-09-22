from django.urls import path

from .document_views import (
	document_classification,
	document_classification_input,
	document_detail,
	document_extraction,
	document_list,
	taxonomy,
)
from .views import (
	google_drive_callback,
	google_drive_connect,
	google_drive_files,
	google_drive_picker_config,
	google_drive_picker_token,
	google_drive_sync,
)


urlpatterns = [
	# Ingestion: connect Drive, pick folders, sync. Writes.
	path('google-drive/connect/', google_drive_connect, name='google-drive-connect'),
	path('google-drive/oauth/callback/', google_drive_callback, name='google-drive-callback'),
	path('google-drive/picker/config/', google_drive_picker_config, name='google-drive-picker-config'),
	path('google-drive/picker/token/', google_drive_picker_token, name='google-drive-picker-token'),
	path('google-drive/files/', google_drive_files, name='google-drive-files'),
	path('google-drive/sync/', google_drive_sync, name='google-drive-sync'),

	# Results: what the pipeline produced. Reads only.
	path('documents/', document_list, name='document-list'),
	path('documents/<uuid:document_id>/', document_detail, name='document-detail'),
	path('documents/<uuid:document_id>/extraction/', document_extraction,
	     name='document-extraction'),
	path('documents/<uuid:document_id>/classification-input/', document_classification_input,
	     name='document-classification-input'),
	path('documents/<uuid:document_id>/classification/', document_classification,
	     name='document-classification'),
	path('taxonomy/', taxonomy, name='taxonomy'),
]
