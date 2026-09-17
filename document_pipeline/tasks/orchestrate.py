from celery import chord, group

from document_pipeline.tasks.classify import classify_chunk_batch_task
from document_pipeline.tasks.finalize import finalize_document_classification_task
from document_pipeline.tasks.ingest import stream_and_parse_document


def trigger_full_document_pipeline(drive_file_id: str, document_id: int):
    """Start document streaming and parsing on the parsing queue."""
    parse_result = stream_and_parse_document.delay(drive_file_id, document_id)
    return parse_result


def trigger_classification_workflow(document_id: int, batch_size: int = 10):
    """Fan out chunk classification and finalize after all batches complete.

    Classification and finalization route to ``llm_queue``; run workers with
    ``celery -A accorder_backend worker -Q llm_queue -c 4``.
    """
    from document_pipeline.models import Chunk, Document

    chunks = list(
        Chunk.objects.filter(document_id=document_id)
        .order_by("sequence_order")
        .only("id")
    )
    batches = [chunks[i : i + batch_size] for i in range(0, len(chunks), batch_size)]
    batch_tasks = [
        classify_chunk_batch_task.s(document_id, [chunk.id for chunk in batch])
        for batch in batches
    ]
    workflow = chord(batch_tasks)(finalize_document_classification_task.s(document_id))
    return workflow