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
    """Build chunks after ingestion, then let chunking queue classification."""
    from document_pipeline.models import ExtractionRun
    from document_pipeline.services.chunking_service import chunk_extraction_run

    try:
        print("[celery] chunking started for document %s" % document_id, flush=True)
        run = (ExtractionRun.objects
               .filter(document_id=document_id, is_current=True)
               .first())
        if run is None:
            raise ValueError("No current extraction run for document %s" % document_id)

        outcome = chunk_extraction_run(run, force=force)
        print(
            "[celery] chunking finished for document %s: status=%s chunks=%d"
            % (document_id, "CHUNKED" if outcome.created else "UNCHANGED", outcome.chunk_count),
            flush=True,
        )
        return {
            "status": "CHUNKED" if outcome.created else "UNCHANGED",
            "document_id": document_id,
            "chunk_run_id": str(outcome.chunk_run.id) if outcome.chunk_run else None,
            "chunks": outcome.chunk_count,
            "skipped": outcome.skipped,
        }
    except Exception as exc:
        print("[celery] chunking failed for document %s: %s" % (document_id, exc), flush=True)
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)