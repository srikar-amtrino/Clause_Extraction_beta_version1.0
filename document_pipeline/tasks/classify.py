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
	from document_pipeline.services.classification_service import classify_batch
	from document_pipeline.pipeline_logger import log_celery_task_started

	task_id = str(getattr(self.request, "id", "local"))
	log_celery_task_started("classify_chunk_batch_task", task_id, f"Run {run_id} (Batch {batch_index})")

	try:
		written = classify_batch(run_id, chunk_ids, batch_index)
		return {
			"status": "CLASSIFIED",
			"run_id": str(run_id),
			"batch_index": batch_index,
			"chunks_written": written,
		}
	except Exception as exc:
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
	from document_pipeline.models import ClassificationRun
	from document_pipeline.services.classification_service import finalize_run
	from document_pipeline.pipeline_logger import log_celery_task_started

	task_id = str(getattr(self.request, "id", "local"))
	log_celery_task_started("finalize_classification_run_task", task_id, f"Run {run_id}")

	run = finalize_run(ClassificationRun.objects.get(pk=run_id))
	print("[celery] finalized classification run %s: %s, %d/%d classified"
	      % (run_id, run.status, run.classified_count, run.micro_count), flush=True)

	# Transition to Review Workspace if classification succeeded
	if run.status in (ClassificationRun.SUCCEEDED, ClassificationRun.SUCCEEDED_WITH_WARNINGS):
		from document_pipeline.tasks.finalize import finalize_document_classification_task
		finalize_document_classification_task.delay(str(run.document_id))

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
	from document_pipeline.tasks.orchestrate import trigger_classification_workflow
	from document_pipeline.pipeline_logger import log_celery_task_started

	task_id = str(getattr(self.request, "id", "local"))
	log_celery_task_started("classify_document_task", task_id, str(document_id))

	print("[celery] classifying document %s" % document_id, flush=True)
	result = trigger_classification_workflow(document_id, force=force)
	if result is None:
		# No current chunk run, or already classified at this taxonomy, prompt
		# and model. Not an error, and not worth a retry.
		print("[celery] nothing to classify for document %s" % document_id, flush=True)
		return {"status": "skipped", "document_id": document_id,
		        "detail": "no chunk run due for classification"}
	return {"status": "queued", "document_id": document_id, "workflow_id": str(result.id)}
