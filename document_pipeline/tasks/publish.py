"""Celery task: embed and publish a reviewed document to the Vector DB.

First publish: embeds ALL paragraph records.
Re-publish (differential): embeds only rows where is_modified=True,
upserts them in the Vector DB, and updates the Postgres copies.

Items a reviewer deleted are never embedded; one the Vector DB already holds
from an earlier publish has its point deleted first.

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
    from document_pipeline.services.embedding_service import (
        delete_points,
        embed_and_upsert,
    )
    from document_pipeline.services.review_service import deleted_paragraph_ids

    sync_run = None
    try:
        doc = Document.objects.get(pk=document_id)
        reviewer = User.objects.filter(pk=user_id).first()
        all_records = list(
            DocumentParagraphRecord.objects
            .filter(document_id=document_id)
            .select_related('chunk', 'document')
            .order_by('sequence_order')
        )
        deleted_ids = deleted_paragraph_ids(doc)
        deleted = [r for r in all_records if r.paragraph_id in deleted_ids]
        to_embed = [r for r in all_records if r.paragraph_id not in deleted_ids]
        # Only what an earlier publish put in the Vector DB has a point to delete.
        to_remove = [r for r in deleted if r.last_synced_at is not None or r.vector_id]
        total = len(to_embed)
        unchanged = 0

        started_at = timezone.now()
        sync_run = VectorSyncRun.objects.create(
            document_id=document_id,
            triggered_by_id=user_id,
            is_differential=False,
            records_total=total,
            records_embedded=len(to_embed),
            records_unchanged=unchanged,
            status=VectorSyncRun.FAILED,
        )

        # 2. Remove deleted items first, so the before/after point count the
        #    upsert reports is about the items that stay.
        removed = delete_points([r.pk for r in to_remove])

        # 3. Embed and upsert the selected paragraphs.
        embed_stats = embed_and_upsert(to_embed, document_id)
        failed = embed_stats.get('failed', 0)
        embedded = embed_stats.get('embedded', 0)
        if failed or embedded != len(to_embed):
            raise RuntimeError(
                'Vector sync incomplete: embedded %d of %d records; %d failed.'
                % (embedded, len(to_embed), failed)
            )

        # 4. Mark embedded records as synced and reset is_modified flag;
        #    deleted ones are no longer in the Vector DB.
        now = timezone.now()
        for record in to_embed:
            record.is_modified = False
            record.last_synced_at = now
            record.vector_id = str(record.pk)
        for record in deleted:
            record.is_modified = False
            record.last_synced_at = None
            record.vector_id = ''
        if to_embed or deleted:
            DocumentParagraphRecord.objects.bulk_update(
                to_embed + deleted, ['is_modified', 'last_synced_at', 'vector_id']
            )

        # 5. Update sync run with final stats.
        sync_run.records_failed = failed
        sync_run.status = VectorSyncRun.SUCCEEDED
        sync_run.finished_at = now
        duration = (now - started_at).total_seconds() * 1000
        sync_run.duration_ms = int(duration)
        sync_run.save(update_fields=[
            'records_failed', 'status', 'finished_at', 'duration_ms'
        ])

        # 6. Update document statuses after the Vector DB sync succeeds.
        new_status = 'published'
        doc.review_status = new_status
        doc.extraction_status = new_status
        doc.save(update_fields=['review_status', 'extraction_status'])

        # 7. Log to activity timeline.
        kind = 'full'
        log_activity(
            document_id=document_id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=DocumentActivityLog.ACT_PUBLISHED,
            summary=(
                     'Published to Vector DB (%s): %d records embedded (%d new, %d updated), '
                     '%d deleted removed.'
                     % (kind, embedded, embed_stats.get('added', 0),
                         embed_stats.get('updated', 0), removed)
            ),
            actor_user=reviewer,
            metadata={
                'kind': kind,
                'embedded': len(to_embed),
                'unchanged': unchanged,
                'failed': failed,
                'added': embed_stats.get('added', 0),
                'updated': embed_stats.get('updated', 0),
                'removed': removed,
                'sync_run_id': str(sync_run.id),
            },
        )

        return {
            'status': 'PUBLISHED',
            'document_id': document_id,
            'embedded': len(to_embed),
            'unchanged': unchanged,
            'failed': failed,
            'added': embed_stats.get('added', 0),
            'updated': embed_stats.get('updated', 0),
            'removed': removed,
            'count_after': embed_stats.get('count_after', 0),
        }

    except Exception as exc:
        if sync_run is not None:
            sync_run.status = VectorSyncRun.FAILED
            sync_run.error_detail = str(exc)[:5000]
            sync_run.finished_at = timezone.now()
            sync_run.save(update_fields=['status', 'error_detail', 'finished_at'])
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
