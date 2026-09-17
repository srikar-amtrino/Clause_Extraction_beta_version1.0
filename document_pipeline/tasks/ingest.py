from celery import shared_task


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
def stream_and_parse_document(self, drive_file_id: str, document_id: int):
	"""Stream a Drive document, parse it into chunks, and run on parsing workers.

	Routes to ``parsing_queue``; run workers with
	``celery -A accorder_backend worker -Q parsing_queue -c 4``.
	"""
	from document_pipeline.services.chunking_service import xml_parse_and_chunk
	from document_pipeline.services.ingestion_service import stream_from_drive

	try:
		file_bytes = stream_from_drive(drive_file_id)
		chunk_count = xml_parse_and_chunk(document_id, file_bytes)
		return {
			"status": "PARSED",
			"document_id": document_id,
			"chunks_created": chunk_count,
		}
	except Exception as exc:
		raise self.retry(exc=exc, countdown=2 ** self.request.retries)
