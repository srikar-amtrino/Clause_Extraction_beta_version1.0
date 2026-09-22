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
def classify_chunk_batch_task(self, run_id: str, chunk_ids: list[str], batch_index: int):
	"""Classify a batch of document chunks on the LLM queue.

	Routes to ``llm_queue``; run workers with
	``celery -A accorder_backend worker -Q llm_queue -c 4``.
	"""
	from document_pipeline.services.classification_service import classify_batch

	try:
		print(
			"[celery] classification batch %d started: run=%s chunks=%d"
			% (batch_index, run_id, len(chunk_ids)), flush=True)
		chunks_classified = classify_batch(run_id, chunk_ids, batch_index)
		print(
			"[celery] classification batch %d finished: run=%s classified=%d"
			% (batch_index, run_id, chunks_classified), flush=True)
		return {
			"status": "CLASSIFIED",
			"run_id": run_id,
			"batch_index": batch_index,
			"chunks_classified": chunks_classified,
		}
	except Exception as exc:
		print(
			"[celery] classification batch %d failed: run=%s error=%s"
			% (batch_index, run_id, exc), flush=True)
		response = getattr(exc, "response", None)
		status_code = getattr(response, "status_code", None)
		countdown = 10 * (2 ** self.request.retries) if status_code == 429 else 2 ** self.request.retries
		raise self.retry(exc=exc, countdown=countdown)
