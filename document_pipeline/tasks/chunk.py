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
def chunk_document_task(self, document_id: str, force=False):
	"""Chunk a document's current extraction run. -> dict

	The stage between ingestion and classification. Pure computation over rows
	already in the database -- no Drive, no Bedrock -- so it shares the parsing
	queue rather than needing one of its own.

	Run a worker on every pipeline queue with ``scripts/run_worker.ps1``
	(or ``run_worker.bat``).
	"""
	from document_pipeline.models import ExtractionRun
	from document_pipeline.services.chunking_service import chunk_extraction_run
	from document_pipeline.pipeline_logger import (
		log_celery_task_started,
		log_chunking_result,
	)

	task_id = str(getattr(self.request, "id", "local"))
	log_celery_task_started("chunk_document_task", task_id, document_id)
	print("[celery] chunking document %s" % document_id, flush=True)
	run = (ExtractionRun.objects
	       .filter(document_id=document_id, is_current=True,
	               status__in=ExtractionRun.USABLE)
	       .first())
	if run is None:
		# Nothing to retry against: the document was never parsed, or its parse
		# was rejected. Reported rather than raised so the chain does not spin.
		print("[celery] no usable extraction run for document %s" % document_id, flush=True)
		return {"status": "skipped", "document_id": document_id,
		        "detail": "no current usable extraction run"}

	outcome = chunk_extraction_run(run, force=force)
	chunk_run = outcome.chunk_run
	log_chunking_result(
		document_id,
		chunk_run,
		macro_count=chunk_run.macro_count,
		micro_count=chunk_run.micro_count,
	)
	print("[celery] chunked document %s: %d chunks, skipped=%s"
	      % (document_id, chunk_run.chunk_count, outcome.skipped), flush=True)
	return {
		"status": "skipped" if outcome.skipped else "chunked",
		"document_id": document_id,
		"chunk_run_id": str(chunk_run.id),
		"chunk_count": chunk_run.chunk_count,
		"micro_count": chunk_run.micro_count,
		# A clause no chunk reaches cannot be classified or cited, so the
		# caller is told rather than having to read the run back.
		"complete": chunk_run.is_complete,
	}
