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
def finalize_document_classification_task(self, run_id: str, document_id: int):
    """Finalize classification, materialise Postgres review records, and gate.

    Pipeline stops here. Embedding is NOT triggered automatically.
    The document waits in ``needs_review`` until a human reviewer
    saves and then explicitly publishes from the workspace.

    Routes to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from document_pipeline.models import Document, DocumentActivityLog
    from document_pipeline.services.finalization_service import (
        check_low_confidence_chunks,
        notify_frontend_via_websocket,
        update_document_status,
    )
    from document_pipeline.services.paragraph_record_service import (
        materialise_paragraph_records,
    )
    from document_pipeline.activity import log_activity

    try:
        # 1. Optionally run the haiku judge for low-confidence chunks.
        needs_judge = check_low_confidence_chunks(document_id)
        if needs_judge:
            from document_pipeline.tasks.judge import trigger_haiku_judge_task
            trigger_haiku_judge_task.delay(document_id)

        # 2. Materialise canonical Postgres records for the review workspace.
        stats = materialise_paragraph_records(document_id)

        # 3. Transition document status -- pipeline pauses here.
        update_document_status(document_id, status="NEEDS_REVIEW")

        # 4. Write 5-phase activity log entries.
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.DATA_CLASSIFICATION,
            action=DocumentActivityLog.ACT_CLASSIFIED,
            summary=(
                'Classified %(total)s paragraphs (%(flagged)s flagged for review).'
                % stats
            ),
            actor_system='LLM Classifier',
            metadata=stats,
        )
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.DATA_CLASSIFICATION,
            action=DocumentActivityLog.ACT_NEEDS_REVIEW,
            summary='Document moved to review queue.',
            actor_system='Pipeline',
        )

        # 5. Notify the frontend that the document is ready for review.
        notify_frontend_via_websocket(document_id, event="DOCUMENT_CLASSIFIED")

        return {
            "status": "FINALIZED",
            "document_id": document_id,
            "needs_judge": needs_judge,
            "paragraph_records": stats,
        }
    except Exception as exc:
        print("[celery] classification finalization failed: run=%s error=%s" % (run_id, exc), flush=True)
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
