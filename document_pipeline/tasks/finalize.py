from celery import shared_task


@shared_task(
    bind=True,
    queue="llm_queue",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=30,
    max_retries=3,
    acks_late=True,
)
def finalize_document_classification_task(self, results, run_id: str, document_id: int):
    """Finalize classification, optionally trigger judging, and notify clients.

    Routes to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from document_pipeline.services.classification_service import finalize_run
    from document_pipeline.models import ClassificationRun

    try:
        run = ClassificationRun.objects.get(pk=run_id)
        run = finalize_run(run)
        return {
            "status": "FINALIZED",
            "document_id": document_id,
            "classification_status": run.status,
            "batches": len(results),
        }
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)