from celery import shared_task


@shared_task(
	bind=True,
	queue="llm_queue",
	autoretry_for=(Exception,),
	retry_backoff=True,
	retry_backoff_max=60,
	max_retries=5,
	rate_limit="60/m",
	acks_late=True,
)
def classify_chunk_batch_task(self, document_id: int, chunk_ids: list[int]):
	"""Classify a batch of document chunks on the LLM queue.

	Routes to ``llm_queue``; run workers with
	``celery -A accorder_backend worker -Q llm_queue -c 4``.
	"""
	from document_pipeline.services.classification_service import classify_batch

	try:
		classifications = classify_batch(document_id, chunk_ids)
		return {
			"status": "CLASSIFIED",
			"document_id": document_id,
			"chunks_classified": len(chunk_ids),
			"classifications": classifications,
		}
	except Exception as exc:
		response = getattr(exc, "response", None)
		status_code = getattr(response, "status_code", None)
		countdown = 10 * (2 ** self.request.retries) if status_code == 429 else 2 ** self.request.retries
		raise self.retry(exc=exc, countdown=countdown)
