from django.urls import path

from .views import (
	google_drive_callback,
	google_drive_connect,
	google_drive_files,
	google_drive_picker,
	google_drive_picker_token,
	google_drive_sync,
)


urlpatterns = [
	path('google-drive/connect/', google_drive_connect, name='google-drive-connect'),
	path('google-drive/oauth/callback/', google_drive_callback, name='google-drive-callback'),
	path('google-drive/picker/', google_drive_picker, name='google-drive-picker'),
	path('google-drive/picker/token/', google_drive_picker_token, name='google-drive-picker-token'),
	path('google-drive/files/', google_drive_files, name='google-drive-files'),
	path('google-drive/sync/', google_drive_sync, name='google-drive-sync'),
]
