"""Celery task: embed and publish a reviewed document to the Vector DB.

First publish: embeds ALL paragraph records.
Re-publish (differential): embeds only rows where is_modified=True,
upserts them in the Vector DB, and updates the Postgres copies.

The task is triggered explicitly by a reviewer clicking Publish --
never automatically after classification.
"""
from celery import shared_task


@shared_task(
    bind=True,
    queue="llm_queue",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
    acks_late=True,
)
def publish_document_task(self, document_id: str, user_id: str):
    """Embed and sync one document to the Vector DB + Postgres.

    Parameters
    ----------
    document_id : str (UUID)
    user_id     : str (UUID) -- the reviewer who clicked Publish.
    """
    from django.utils import timezone
    from core.models import User
    from document_pipeline.models import (
        Document,
        DocumentActivityLog,
        DocumentParagraphRecord,
        VectorSyncRun,
    )
    from document_pipeline.activity import log_activity
    from document_pipeline.services.embedding_service import embed_and_upsert

    try:
        doc = Document.objects.get(pk=document_id)
        reviewer = User.objects.filter(pk=user_id).first()
        is_first_publish = doc.review_status != 'published'

        # 1. Select paragraphs to embed.
        if is_first_publish:
            to_embed = list(
                DocumentParagraphRecord.objects
                .filter(document_id=document_id)
                .order_by('sequence_order')
            )
        else:
            to_embed = list(
                DocumentParagraphRecord.objects
                .filter(document_id=document_id, is_modified=True)
                .order_by('sequence_order')
            )

        total = DocumentParagraphRecord.objects.filter(document_id=document_id).count()
        unchanged = total - len(to_embed)

        started_at = timezone.now()
        sync_run = VectorSyncRun.objects.create(
            document_id=document_id,
            triggered_by_id=user_id,
            is_differential=not is_first_publish,
            records_total=total,
            records_embedded=len(to_embed),
            records_unchanged=unchanged,
            status=VectorSyncRun.SUCCEEDED,
        )

        # 2. Embed and upsert (stub if embedding service not yet wired).
        embed_stats = embed_and_upsert(to_embed, document_id)

        # 3. Mark embedded records as synced and reset is_modified flag.
        now = timezone.now()
        pks = [r.pk for r in to_embed]
        DocumentParagraphRecord.objects.filter(pk__in=pks).update(
            is_modified=False,
            last_synced_at=now,
        )

        # 4. Update sync run with final stats.
        sync_run.records_failed = embed_stats.get('failed', 0)
        sync_run.status = (
            VectorSyncRun.FAILED if embed_stats.get('failed', 0) > 0
            else VectorSyncRun.SUCCEEDED
        )
        sync_run.finished_at = now
        duration = (now - started_at).total_seconds() * 1000
        sync_run.duration_ms = int(duration)
        sync_run.save(update_fields=[
            'records_failed', 'status', 'finished_at', 'duration_ms'
        ])

        # 5. Update document review_status.
        new_status = 'published'
        doc.review_status = new_status
        doc.save(update_fields=['review_status'])

        # 6. Log to activity timeline.
        kind = 'full' if is_first_publish else 'differential'
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=DocumentActivityLog.ACT_PUBLISHED,
            summary=(
                'Published to Vector DB (%s): %d records embedded, %d unchanged.'
                % (kind, len(to_embed), unchanged)
            ),
            actor_user=reviewer,
            metadata={
                'kind': kind,
                'embedded': len(to_embed),
                'unchanged': unchanged,
                'failed': embed_stats.get('failed', 0),
                'sync_run_id': str(sync_run.id),
            },
        )

        return {
            'status': 'PUBLISHED',
            'document_id': document_id,
            'embedded': len(to_embed),
            'unchanged': unchanged,
            'failed': embed_stats.get('failed', 0),
        }

    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
