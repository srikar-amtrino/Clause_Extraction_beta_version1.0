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
def classify_chunk_batch_task(self, run_id: str, chunk_ids: list, batch_index: int = 0):
	"""Classify one batch of an open classification run. -> dict

	`run_id` is a ClassificationRun the orchestrator already opened, not a
	document: the run records the taxonomy, prompt and model every batch has to
	agree on, so a worker cannot drift from the run it is filling in.

	Idempotent -- the service skips chunks that already hold a row -- so a
	retried task after a partial write adds nothing twice.

	Routes to ``llm_queue``; run workers with
	``celery -A accorder_backend worker -Q llm_queue -c 4``.
	"""
	from document_pipeline.services.classification_service import classify_batch

	try:
		written = classify_batch(run_id, chunk_ids, batch_index)
		return {
			"status": "CLASSIFIED",
			"run_id": str(run_id),
			"batch_index": batch_index,
			"chunks_written": written,
		}
	except Exception as exc:
		print(
			"[celery] classification batch %d failed: run=%s error=%s"
			% (batch_index, run_id, exc), flush=True)
		response = getattr(exc, "response", None)
		status_code = getattr(response, "status_code", None)
		countdown = 10 * (2 ** self.request.retries) if status_code == 429 else 2 ** self.request.retries
		raise self.retry(exc=exc, countdown=countdown)


@shared_task(
	bind=True,
	queue="llm_queue",
	autoretry_for=(Exception,),
	retry_backoff=True,
	retry_backoff_max=30,
	max_retries=3,
	acks_late=True,
)
def finalize_classification_run_task(self, _batch_results, run_id: str):
	"""Close a classification run once every batch has reported. -> dict

	The chord callback for ``classify_chunk_batch_task``. Counting and
	promotion live in the service: a run only becomes the document's current
	classification when every micro chunk holds a row, so a lost batch leaves
	the previous run in place rather than publishing a half-answered document.

	`_batch_results` is what the chord passes from its header and is unused;
	the run itself is the record of what landed.
	"""
	from document_pipeline.models import ClassificationRun
	from document_pipeline.services.classification_service import finalize_run

	run = finalize_run(ClassificationRun.objects.get(pk=run_id))
	print("[celery] finalized classification run %s: %s, %d/%d classified"
	      % (run_id, run.status, run.classified_count, run.micro_count), flush=True)
	return {
		"status": run.status,
		"run_id": str(run_id),
		"document_id": str(run.document_id),
		"micro_count": run.micro_count,
		"classified_count": run.classified_count,
		"unclassified_count": run.unclassified_count,
		"failed_count": run.failed_count,
		"review_count": run.review_count,
		"is_current": run.is_current,
	}


@shared_task(
	bind=True,
	queue="llm_queue",
	autoretry_for=(Exception,),
	retry_backoff=True,
	retry_backoff_max=60,
	max_retries=3,
	acks_late=True,
)
def classify_document_task(self, document_id: str, force=False):
	"""Open a classification run for a document and fan its batches out. -> dict

	The last link of the ingest chain, so a synced document reaches a verdict
	without anyone running a second command. The work itself is not done here:
	this opens the run and hands the batches to `classify_chunk_batch_task`,
	because one document can be hundreds of Bedrock calls and holding them in
	a single task would lose all of them to one timeout.

	Routes to ``llm_queue``; run workers with
	``celery -A accorder_backend worker -Q llm_queue -c 4``.
	"""
	from document_pipeline.tasks.orchestrate import trigger_classification_workflow

	print("[celery] classifying document %s" % document_id, flush=True)
	result = trigger_classification_workflow(document_id, force=force)
	if result is None:
		# No current chunk run, or already classified at this taxonomy, prompt
		# and model. Not an error, and not worth a retry.
		print("[celery] nothing to classify for document %s" % document_id, flush=True)
		return {"status": "skipped", "document_id": document_id,
		        "detail": "no chunk run due for classification"}
	return {"status": "queued", "document_id": document_id, "workflow_id": str(result.id)}
