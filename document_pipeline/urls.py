from django.urls import path

from .document_views import (
	document_classification,
	document_classification_input,
	document_detail,
	document_extraction,
	document_list,
	taxonomy,
)
from .review_views import (
	activity_calendar,
	bulk_update,
	document_activity,
	document_contributors,
	document_note,
	document_queue,
	document_stats,
	draft_discard,
	draft_save,
	lock_acquire,
	lock_heartbeat,
	lock_release,
	paragraph_update,
	workspace_detail,
	workspace_publish,
	workspace_save,
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

	# Review workspace -- overview helpers.
	path('documents/stats/', document_stats, name='document-stats'),
	path('documents/queue/', document_queue, name='document-queue'),

	# Review workspace -- per document.
	path('documents/<uuid:document_id>/workspace/', workspace_detail, name='workspace-detail'),
	path('documents/<uuid:document_id>/workspace/lock/', lock_acquire, name='workspace-lock-acquire'),
	path('documents/<uuid:document_id>/workspace/lock/heartbeat/', lock_heartbeat, name='workspace-lock-heartbeat'),
	path('documents/<uuid:document_id>/workspace/lock/release/', lock_release, name='workspace-lock-release'),
	path('documents/<uuid:document_id>/workspace/paragraphs/<str:para_id>/', paragraph_update, name='workspace-paragraph-update'),
	path('documents/<uuid:document_id>/workspace/bulk-update/', bulk_update, name='workspace-bulk-update'),
	path('documents/<uuid:document_id>/workspace/draft/', draft_save, name='workspace-draft-save'),
	path('documents/<uuid:document_id>/workspace/draft/discard/', draft_discard, name='workspace-draft-discard'),
	path('documents/<uuid:document_id>/workspace/save/', workspace_save, name='workspace-save'),
	path('documents/<uuid:document_id>/workspace/publish/', workspace_publish, name='workspace-publish'),

	# Activity log & contributions.
	path('documents/<uuid:document_id>/activity/', document_activity, name='document-activity'),
	path('documents/<uuid:document_id>/contributors/', document_contributors, name='document-contributors'),
	path('documents/<uuid:document_id>/note/', document_note, name='document-note'),
	path('activity/calendar/', activity_calendar, name='activity-calendar'),
]
