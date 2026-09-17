from celery import shared_task


@shared_task(
    bind=True,
    queue="llm_queue",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
    rate_limit="30/m",
)
def trigger_haiku_judge_task(self, document_id: int):
    """Run the Haiku judge for low-confidence chunks on the LLM queue.

    Routes to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from document_pipeline.services.judge_service import run_haiku_judge

    try:
        results = run_haiku_judge(document_id)
        return {
            "status": "JUDGE_COMPLETE",
            "document_id": document_id,
            "chunks_reclassified": len(results),
        }
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)