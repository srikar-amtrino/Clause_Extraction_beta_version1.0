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
def finalize_document_classification_task(self, document_id: int):
    """Finalize classification, optionally trigger judging, and notify clients.

    Routes to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from document_pipeline.models import Document
    from document_pipeline.services.finalization_service import (
        check_low_confidence_chunks,
        notify_frontend_via_websocket,
        update_document_status,
    )

    try:
        needs_judge = check_low_confidence_chunks(document_id)
        if needs_judge is True:
            from document_pipeline.tasks.judge import trigger_haiku_judge_task

            trigger_haiku_judge_task.delay(document_id)
        update_document_status(document_id, status="NEEDS_REVIEW")
        notify_frontend_via_websocket(document_id, event="DOCUMENT_CLASSIFIED")
        return {
            "status": "FINALIZED",
            "document_id": document_id,
            "needs_judge": needs_judge,
        }
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)