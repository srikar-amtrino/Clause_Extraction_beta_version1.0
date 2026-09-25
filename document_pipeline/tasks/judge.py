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

    Routes to ``llm_queue``; ``scripts/run_worker.ps1`` (or ``run_worker.bat``)
    runs a worker on it.
    """
    try:
        from document_pipeline.services.judge_service import run_haiku_judge
        results = run_haiku_judge(document_id)
        return {
            "status": "JUDGE_COMPLETE",
            "document_id": document_id,
            "chunks_reclassified": len(results),
        }
    except ModuleNotFoundError:
        # Service not implemented; review workspace handles low-confidence items
        return {
            "status": "JUDGE_SKIPPED",
            "document_id": document_id,
            "reason": "judge_service not implemented; low-confidence chunks routed to Review Workspace",
        }
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)