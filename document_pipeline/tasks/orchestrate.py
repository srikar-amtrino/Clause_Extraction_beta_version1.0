from celery import chord, group

from document_pipeline.tasks.classify import classify_chunk_batch_task
from document_pipeline.tasks.finalize import finalize_document_classification_task
from document_pipeline.tasks.ingest import stream_document_task


def trigger_full_document_pipeline(credentials_json: str, document_id: str):
    """Start Drive streaming and ingestion on the streaming I/O queue."""
    parse_result = stream_document_task.delay(credentials_json, document_id)
    return parse_result


def trigger_classification_workflow(document_id: int, batch_size: int = 10):
    """Fan out chunk classification and finalize after all batches complete.

    Classification and finalization route to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from django.conf import settings
    from document_pipeline.classification.bedrock_client import classifier_from_settings
    from document_pipeline.classification.taxonomy import load_vocabulary
    from document_pipeline.models import ChunkRun
    from document_pipeline.services.classification_service import plan_run_batches, start_run

    chunk_run = (ChunkRun.objects
                 .select_related("extraction_run")
                 .filter(extraction_run__document_id=document_id, is_current=True)
                 .first())
    if chunk_run is None:
        raise ValueError("No current chunk run for document %s" % document_id)

    classifier = classifier_from_settings()
    vocab = load_vocabulary(settings.CLASSIFY_TAXONOMY_VERSION)
    run = start_run(chunk_run, classifier=classifier, vocab=vocab)
    batches = plan_run_batches(run)
    batch_tasks = [
        classify_chunk_batch_task.s(str(run.id), [p.chunk_id for p in batch.paragraphs], batch.index)
        for batch in batches
    ]
    workflow = chord(group(batch_tasks))(
        finalize_document_classification_task.si(str(run.id), document_id))
    return workflow