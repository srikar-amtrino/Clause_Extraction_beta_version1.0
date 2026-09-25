"""Wiring between the queues: which task follows which, for one document.

The stages themselves live in the services. Nothing here decides anything
about a document; it only says what runs next and on which queue, so the same
flow the management commands run in one process can run across workers.
"""
from celery import chain, chord

from document_pipeline.tasks.chunk import chunk_document_task
from document_pipeline.tasks.classify import (
    classify_chunk_batch_task,
    classify_document_task,
    finalize_classification_run_task,
)
from document_pipeline.tasks.ingest import stream_document_task


def trigger_full_document_pipeline(credentials_json: str, document_id: str, force=False,
                                   classify=None):
    """Drive -> parse -> chunk -> classify, for one document.

    Chained rather than fanned out: each stage reads what the one before it
    wrote, so none of them can start early. The last link only *opens* the
    classification run and fans its batches over the LLM queue, because the
    chord header cannot be built until the chunks exist.

    `classify` defaults to PIPELINE_CLASSIFY_ON_SYNC. Turning it off is what a
    large folder is for: classification is the only stage that calls a paid
    model, and syncing a hundred contracts fires a hundred of them.
    """
    from django.conf import settings

    if classify is None:
        classify = getattr(settings, 'PIPELINE_CLASSIFY_ON_SYNC', True)
    steps = [stream_document_task.s(credentials_json, document_id, force),
             chunk_document_task.si(document_id, force)]
    if classify:
        steps.append(classify_document_task.si(document_id, force))
    return chain(*steps).delay()


def trigger_classification_workflow(document_id: str, *, force=False, classifier=None):
    """Fan the document's micro chunks out over the LLM queue. -> AsyncResult or None

    The run is opened here, not inside the workers: every batch has to be
    written against one run, recording one taxonomy, prompt and model, and only
    the caller knows the whole set of batches. Workers then fill it in, and the
    chord callback closes it.

    Returns None when there is nothing to classify -- no current chunk run, or
    one already classified at the current configuration -- so a caller can tell
    'queued' from 'nothing to do' without reading the database back.

    Batching is the service's: siblings travel together so the model sees a
    clause beside the clauses around it.
    """
    from django.conf import settings

    from document_pipeline.classification.bedrock_client import classifier_from_settings
    from document_pipeline.classification.prompt import PROMPT_VERSION
    from document_pipeline.classification.taxonomy import load_vocabulary
    from document_pipeline.models import ChunkRun, ClassificationRun, ExtractionRun
    from document_pipeline.services.classification_service import (
        is_up_to_date,
        plan_run_batches,
        start_run,
    )

    chunk_run = (ChunkRun.objects
                 .filter(extraction_run__document_id=document_id,
                         is_current=True,
                         extraction_run__is_current=True,
                         extraction_run__status__in=ExtractionRun.USABLE)
                 .select_related('extraction_run')
                 .first())
    if chunk_run is None:
        print('[celery] classification skipped document=%s '
              'reason=no_current_usable_chunk_run' % document_id, flush=True)
        return None

    classifier = classifier or classifier_from_settings()
    vocab = load_vocabulary(settings.CLASSIFY_TAXONOMY_VERSION)
    current = ClassificationRun.objects.filter(chunk_run=chunk_run, is_current=True).first()
    if not force and is_up_to_date(current, vocab.version, classifier.model_id):
        print('[celery] classification skipped document=%s '
              'reason=already_classified taxonomy=%s prompt=%s model=%s'
              % (document_id, vocab.version, PROMPT_VERSION, classifier.model_id),
              flush=True)
        return None

    run = start_run(chunk_run, classifier=classifier, vocab=vocab)
    batches = plan_run_batches(run)
    if not batches:
        # No micro chunks: close the run now rather than leaving it running,
        # which would make the next attempt report it as abandoned.
        return finalize_classification_run_task.delay(None, str(run.id))

    header = [classify_chunk_batch_task.s(str(run.id),
                                          [str(p.chunk_id) for p in batch.paragraphs],
                                          batch.index)
              for batch in batches]
    return chord(header)(finalize_classification_run_task.s(str(run.id)))
