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
def finalize_document_classification_task(self, document_id: str):
    """Finalize classification, materialise Postgres review records, and gate.

    Pipeline stops here. Embedding is NOT triggered automatically.
    The document waits in ``needs_review`` until a human reviewer
    saves and then explicitly publishes from the workspace.

    Routes to ``llm_queue``; ``scripts/run_worker.ps1`` (or ``run_worker.bat``)
    runs a worker on it.
    """
    from document_pipeline.services.finalization_service import (
        notify_frontend_via_websocket,
        update_document_status,
    )
    from document_pipeline.services.paragraph_record_service import (
        materialise_paragraph_records,
    )
    from document_pipeline.activity import log_moved_to_review
    from document_pipeline.pipeline_logger import log_finalization_complete

    try:
        print('[REVIEW WORKSPACE] finalization started document=%s' % document_id, flush=True)
        # 1. Low-confidence chunks (< 0.7) are automatically flagged for
        # human review in the Review Workspace during materialise_paragraph_records below.
        # Haiku judge service is not yet implemented.

        # 2. Materialise canonical Postgres records for the review workspace.
        stats = materialise_paragraph_records(document_id)
        print(
            '[REVIEW WORKSPACE] paragraph records result document=%s stats=%s'
            % (document_id, stats),
            flush=True,
        )

        # 3. Transition document status -- pipeline pauses here.
        update_document_status(document_id, status="NEEDS_REVIEW")

        # 4. Activity log. The `classified` event was written when the run
        # closed; this one is written once per run, however often this retries.
        log_moved_to_review(document_id, stats)

        # 5. Log storytelling completion
        log_finalization_complete(
            str(document_id),
            paragraph_records_count=stats.get("total", 0),
            flagged_for_review=stats.get("flagged", 0),
        )

        # 6. Notify the frontend that the document is ready for review.
        notify_frontend_via_websocket(document_id, event="DOCUMENT_CLASSIFIED")

        print(
            '[REVIEW WORKSPACE] finalization completed document=%s status=needs_review'
            % document_id,
            flush=True,
        )

        return {
            "status": "FINALIZED",
            "document_id": document_id,
            "paragraph_records": stats,
        }
    except Exception as exc:
        print('[REVIEW WORKSPACE] finalization failed document=%s error=%s: %s'
              % (document_id, type(exc).__name__, exc), flush=True)
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
