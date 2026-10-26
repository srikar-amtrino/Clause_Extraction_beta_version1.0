import os

from celery import Celery

os.environ.setdefault(
	"DJANGO_SETTINGS_MODULE",
	"accorder_backend.settings.development",
)

app = Celery(
	"accorder_backend",
	include=(
		"document_pipeline.tasks.chunk",
		"document_pipeline.tasks.classify",
		"document_pipeline.tasks.draft_cleaner",
		"document_pipeline.tasks.finalize",
		"document_pipeline.tasks.ingest",
		"document_pipeline.tasks.judge",
		"document_pipeline.tasks.publish",
	),
)

app.config_from_object("django.conf:settings", namespace="CELERY")
