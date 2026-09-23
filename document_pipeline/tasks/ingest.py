from celery import shared_task

from document_pipeline.connectors.GoogleDrive.oauth import credentials_from_json


def _ingest_document(self, credentials_json: str, document_id: str, force=False):
	from document_pipeline.models import Document
	from document_pipeline.services.ingestion_service import ingest_document

	print("[celery] streaming worker starting document %s" % document_id, flush=True)
	try:
		credentials = credentials_from_json(credentials_json)
		try:
			document = Document.objects.select_related("ingestion_source").get(pk=document_id)
		except Document.DoesNotExist:
			print(
				"[celery] streaming worker skipped missing document %s" % document_id,
				flush=True,
			)
			return {"status": "missing", "document_id": document_id, "skipped": True}
		outcome = ingest_document(credentials, document, force=force)
		run = outcome.run
		if not outcome.skipped and run.is_usable:
			from document_pipeline.tasks.chunk import chunk_document_task

			chunk_document_task.delay(str(document.id), force=False)
			print("[celery] queued chunking for document %s" % document_id, flush=True)
		print(
			"[celery] streaming worker finished document %s: status=%s skipped=%s"
			% (document_id, run.status, outcome.skipped),
			flush=True,
		)
		return {
			"status": run.status,
			"document_id": document_id,
			"skipped": outcome.skipped,
			"clauses_created": outcome.clause_count,
			"paragraphs_created": outcome.paragraph_count,
		}
	except Exception as exc:
		print("[celery] streaming worker failed for document %s: %s" % (document_id, exc), flush=True)
		raise self.retry(exc=exc, countdown=2 ** self.request.retries)


@shared_task(
	bind=True,
	queue="streaming_io_queue",
	autoretry_for=(Exception,),
	retry_backoff=True,
	retry_backoff_max=300,
	max_retries=3,
	acks_late=True,
	reject_on_worker_lost=True,
)
def stream_document_task(self, credentials_json: str, document_id: str, force=False):
	"""Stream a Drive file and ingest it on a dedicated I/O worker.

	Run workers with ``celery -A accorder_backend worker
	-Q streaming_io_queue --pool=solo --loglevel=INFO``.
	"""
	return _ingest_document(self, credentials_json, document_id, force)


@shared_task(
	bind=True,
	queue="parsing_queue",
	autoretry_for=(Exception,),
	retry_backoff=True,
	retry_backoff_max=300,
	max_retries=3,
	acks_late=True,
	reject_on_worker_lost=True,
)
def ingest_document_task(self, credentials_json: str, document_id: str, force=False):
	"""Backward-compatible ingestion task routed to the parsing queue."""
	return _ingest_document(self, credentials_json, document_id, force)