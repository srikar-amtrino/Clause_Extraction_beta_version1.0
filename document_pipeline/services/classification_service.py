"""Phase 2, classification: label every micro chunk of one chunk run.

Append-only like parsing and chunking. A run is created `running` and not
current, filled batch by batch, and promoted to current only when finalize
proves every micro chunk has a row. A reader filtering on is_current never
sees a half-written run, and a re-run never rewrites rows a review already
points at.

The three layers of the design:

1. Context. Each request carries the full taxonomy -- definitions, aliases,
   exclusions -- in a cached system prompt, and each paragraph arrives inside
   its section with its heading trail, title and lead-in.
2. Constrained output. The answer's JSON schema is enforced by the API: the
   type must be a listed name and a Non-clause has no sub_type to fill.
3. Deterministic post-processing, here. Every item is validated again, ids are
   matched back to chunks, the deviation check and review routing are computed
   rather than trusted to the model, and every micro ends with exactly one row:
   classified, unclassified, or failed after its attempts ran out.

Workers do network only; the calling thread does every database write, so no
connection is ever shared between threads. start_run / classify_batch /
finalize_run are the same steps a task queue would call one by one;
classify_chunk_run composes them for the command line.
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from pydantic import ValidationError

from document_pipeline.classification import prompt as prompts
from document_pipeline.classification.batching import Batch, Group, Paragraph, plan_batches
from document_pipeline.classification.bedrock_client import classifier_from_settings
from document_pipeline.classification.schema import output_schema
from document_pipeline.classification.taxonomy import CLAUSE, NON_CLAUSE, load_vocabulary
from document_pipeline.models import (
    CanonicalType,
    Chunk,
    ChunkRun,
    Classification,
    ClassificationCall,
    ClassificationRun,
    PipelineStageLog,
)

logger = logging.getLogger(__name__)


def _trace(message):
    print('[CLASSIFICATION] %s' % message, flush=True)

MICRO_FIELDS = ('id', 'local_id', 'order_index', 'clause_identifier', 'title', 'breadcrumb',
                'lead_in_text', 'region', 'text', 'parent_local_id')


@dataclass
class ClassificationOutcome:
    chunk_run: ChunkRun
    run: ClassificationRun | None
    created: bool = False      # a new run was written
    skipped: bool = False      # the current run is already at these versions


@dataclass
class ItemResult:
    """One paragraph's answer after post-processing, before it is a row."""

    outcome: str
    label: str | None = None
    type_key: str | None = None
    sub_type: str | None = None
    confidence: float | None = None
    reason: str = ''
    raw_item: dict | None = None
    notes: list = field(default_factory=list)
    error: str = ''
    attempts: int = 1


@dataclass
class CallRecord:
    batch_index: int
    attempt: int
    chunk_ids: list
    status: str
    stop_reason: str
    request_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    latency_ms: int
    raw_output: str
    error: str = ''


@dataclass
class BatchResolution:
    batch: Batch
    results: dict      # chunk_id -> ItemResult
    calls: list        # CallRecord


@dataclass(frozen=True)
class RunContext:
    """Everything a worker needs, built once per run, read-only afterwards."""

    vocab: object
    schema: object
    system: list
    document_title: str
    contract_type: str
    max_attempts: int


# ------------------------------------------------------------------ entry point

def classify_chunk_run(chunk_run, *, force=False, classifier=None, concurrency=None):
    """Classify every micro chunk of one chunk run. -> ClassificationOutcome

    Raises ValueError when the chunk run is not the current one for a usable
    parse, and ConfigurationError / TransientError when Bedrock cannot serve
    the run; in both Bedrock cases the new run is marked failed and the
    previous current run, if any, stays current.
    """
    _check_classifiable(chunk_run)
    classifier = classifier or classifier_from_settings()
    vocab = load_vocabulary(settings.CLASSIFY_TAXONOMY_VERSION)
    _routing_settings(vocab)

    current = ClassificationRun.objects.filter(chunk_run=chunk_run, is_current=True).first()
    if not force and is_up_to_date(current, vocab.version, classifier.model_id):
        return ClassificationOutcome(chunk_run=chunk_run, run=current, skipped=True)

    run = start_run(chunk_run, classifier=classifier, vocab=vocab)
    try:
        batches = plan_run_batches(run)
        context = _context(run, vocab)
        workers = max(1, concurrency or settings.CLASSIFY_CONCURRENCY)
        _execute(run, batches, classifier=classifier, context=context, workers=workers)
        run = finalize_run(run)
    except BaseException as exc:
        fail_run(run, exc)
        raise
    return ClassificationOutcome(chunk_run=chunk_run, run=run, created=True)


def is_up_to_date(run, taxonomy_version, model_id):
    """True when `run` was produced by exactly the current configuration."""
    return bool(run is not None
                and run.taxonomy_version == taxonomy_version
                and run.prompt_version == prompts.PROMPT_VERSION
                and run.model_id == model_id)


def _check_classifiable(chunk_run):
    extraction_run = chunk_run.extraction_run
    if not (chunk_run.is_current and extraction_run.is_current and extraction_run.is_usable):
        raise ValueError('ChunkRun %s is not the current chunking of a current, usable parse; '
                         'only that can be classified.' % chunk_run.id)
    if not chunk_run.is_complete:
        # Classifying is still worthwhile, but the coverage gap means some
        # verdict may not trace back to its source text.
        logger.warning('classifying chunk run %s despite a chunking coverage gap', chunk_run.id)


def _routing_settings(vocab):
    """Fail before spending anything if review routing is misconfigured."""
    unknown = [k for k in settings.CLASSIFY_HIGH_RISK_TYPES if k not in vocab.by_key]
    if unknown:
        raise ImproperlyConfigured('CLASSIFY_HIGH_RISK_TYPES has keys that are not in taxonomy '
                                   '%s: %s' % (vocab.version, ', '.join(unknown)))
    if not 0.0 <= settings.CLASSIFY_CONFIDENCE_THRESHOLD <= 1.0:
        raise ImproperlyConfigured('CLASSIFY_CONFIDENCE_THRESHOLD must be between 0 and 1.')
    if settings.CLASSIFY_ITEM_ATTEMPTS < 1:
        raise ImproperlyConfigured('CLASSIFY_ITEM_ATTEMPTS must be at least 1.')


# ------------------------------------------------------------------ run lifecycle

def start_run(chunk_run, *, classifier, vocab):
    """Open a new run: running, not current, with the exact prompt recorded."""
    system_text = prompts.render_system_prompt(vocab)
    micro_count = Chunk.objects.filter(chunk_run=chunk_run, kind=Chunk.MICRO).count()
    now = timezone.now()
    with transaction.atomic():
        # Serialise runs of the same chunk run; a no-op on SQLite.
        ChunkRun.objects.select_for_update().filter(pk=chunk_run.pk).first()
        # A run still `running` here was interrupted (a killed process). It can
        # never be finished now, so it is closed rather than left dangling.
        abandoned = (ClassificationRun.objects
                     .filter(chunk_run=chunk_run, status=ClassificationRun.RUNNING)
                     .update(status=ClassificationRun.FAILED, finished_at=now,
                             error_detail='abandoned: a newer run started before this one '
                                          'finished'))
        previous = (ClassificationRun.objects.filter(chunk_run=chunk_run)
                    .order_by('-attempt').first())
        run = ClassificationRun.objects.create(
            chunk_run=chunk_run,
            document_id=chunk_run.extraction_run.document_id,
            attempt=(previous.attempt + 1) if previous else 1,
            is_current=False,
            status=ClassificationRun.RUNNING,
            taxonomy_version=vocab.version,
            prompt_version=prompts.PROMPT_VERSION,
            model_id=classifier.model_id,
            bedrock_client=classifier.client_kind,
            system_prompt=system_text,
            system_prompt_sha256=prompts.prompt_sha256(system_text),
            params={
                'region': classifier.region,
                'thinking': classifier.thinking,
                'effort': classifier.effort,
                'max_tokens': classifier.max_tokens,
                'max_batch_tokens': settings.CLASSIFY_MAX_BATCH_TOKENS,
                'max_items_per_batch': settings.CLASSIFY_MAX_ITEMS_PER_BATCH,
                'item_attempts': settings.CLASSIFY_ITEM_ATTEMPTS,
                'confidence_threshold': settings.CLASSIFY_CONFIDENCE_THRESHOLD,
                'high_risk_types': list(settings.CLASSIFY_HIGH_RISK_TYPES),
            },
            micro_count=micro_count,
            started_at=now,
        )
    if abandoned:
        logger.warning('closed %d abandoned classification run(s) for chunk run %s',
                       abandoned, chunk_run.id)
    return run


def plan_run_batches(run):
    """The run's batches, in reading order. A task queue fans these out as
    classify_batch(run.id, [p.chunk_id for p in batch.paragraphs], batch.index)."""
    return plan_batches(_groups_for(run.chunk_run),
                        max_tokens=settings.CLASSIFY_MAX_BATCH_TOKENS,
                        max_items=settings.CLASSIFY_MAX_ITEMS_PER_BATCH)


def classify_batch(run_id, chunk_ids, batch_index=0, *, classifier=None):
    """Classify some micro chunks of an open run. -> number of rows written.

    Idempotent: chunks that already have a row in the run are skipped, so a
    retried task writes nothing twice.
    """
    run = ClassificationRun.objects.select_related('chunk_run__extraction_run').get(pk=run_id)
    if run.status != ClassificationRun.RUNNING:
        raise ValueError('ClassificationRun %s is %s, not running.' % (run.id, run.status))
    classifier = classifier or classifier_from_settings()
    if classifier.model_id != run.model_id:
        raise ValueError('ClassificationRun %s was started with a different model than this '
                         'worker is configured for.' % run.id)
    done = {str(pk) for pk in Classification.objects.filter(run=run, chunk_id__in=chunk_ids)
            .values_list('chunk_id', flat=True)}
    todo = [str(c) for c in chunk_ids if str(c) not in done]
    if not todo:
        return 0
    vocab = load_vocabulary(run.taxonomy_version)
    batch = Batch(batch_index, tuple(_groups_for(run.chunk_run, only=todo)))

    from document_pipeline.pipeline_logger import (
        log_claude_call_details,
        log_claude_call_start,
    )
    log_claude_call_start(str(run.id), batch_index, len(todo), classifier.model_id)

    resolution = resolve_batch(batch, classifier=classifier, context=_context(run, vocab))
    written = write_resolution(run, resolution, vocab=vocab)

    try:
        context = _context(run, vocab)
        batch_prompt_text = prompts.render_user_message(
            batch,
            document_title=context.document_title,
            contract_type=context.contract_type,
        )

        for call in resolution.calls:
            parsed_summary = []
            for cid, res in resolution.results.items():
                parsed_summary.append({
                    'paragraph_id': getattr(res, 'paragraph_id', str(cid)),
                    'label': getattr(res, 'label', 'Clause') or 'Clause',
                    'canonical_type': getattr(res, 'type_key', '') or '',
                    'confidence': getattr(res, 'confidence', 0.0) or 0.0,
                    'issues': list(getattr(res, 'notes', [])),
                })
            log_claude_call_details(
                run_id=str(run.id),
                batch_index=batch_index,
                system_prompt=run.system_prompt or '',
                batch_prompt=batch_prompt_text,
                raw_response=call.raw_output,
                input_tokens=call.input_tokens,
                output_tokens=call.output_tokens,
                latency_ms=call.latency_ms,
                parsed_results=parsed_summary,
            )
    except Exception as log_err:
        logger.warning("Error logging Claude call details: %s", log_err)

    return len(written)


def finalize_run(run):
    """Close a run: count it, and promote it if every micro chunk has a row.

    Idempotent: a run that is no longer running is returned untouched.
    """
    finished = timezone.now()
    with transaction.atomic():
        run = ClassificationRun.objects.select_for_update().get(pk=run.pk)
        if run.status != ClassificationRun.RUNNING:
            return run

        micro_ids = set(Chunk.objects.filter(chunk_run_id=run.chunk_run_id, kind=Chunk.MICRO)
                        .values_list('id', flat=True))
        rows = Classification.objects.filter(run=run)
        missing = micro_ids - set(rows.values_list('chunk_id', flat=True))
        counts = rows.aggregate(
            classified=Count('id', filter=Q(outcome=Classification.CLASSIFIED)),
            unclassified=Count('id', filter=Q(outcome=Classification.UNCLASSIFIED)),
            failed=Count('id', filter=Q(outcome=Classification.FAILED)),
            review=Count('id', filter=Q(needs_review=True)),
        )
        spend = run.calls.aggregate(
            calls=Count('id'), input=Sum('input_tokens'), output=Sum('output_tokens'),
            cache_read=Sum('cache_read_tokens'), cache_write=Sum('cache_write_tokens'))

        run.micro_count = len(micro_ids)
        run.classified_count = counts['classified']
        run.unclassified_count = counts['unclassified']
        run.failed_count = counts['failed']
        run.review_count = counts['review']
        run.call_count = spend['calls']
        run.input_tokens = spend['input'] or 0
        run.output_tokens = spend['output'] or 0
        run.cache_read_tokens = spend['cache_read'] or 0
        run.cache_write_tokens = spend['cache_write'] or 0
        run.finished_at = finished
        run.duration_ms = int((finished - run.started_at).total_seconds() * 1000)
        run.stats = {'review_reasons': _reason_counts(rows),
                     'types': dict(rows.filter(outcome=Classification.CLASSIFIED)
                                   .values_list('canonical_type__key')
                                   .annotate(n=Count('id')).order_by())}

        if missing:
            run.status = ClassificationRun.FAILED
            run.error_detail = '%d micro chunk(s) were never classified' % len(missing)
        elif micro_ids and counts['failed'] == len(micro_ids):
            run.status = ClassificationRun.FAILED
            run.error_detail = 'no micro chunk could be classified'
        else:
            run.status = (ClassificationRun.SUCCEEDED if counts['failed'] == 0
                          else ClassificationRun.SUCCEEDED_WITH_WARNINGS)
            (ClassificationRun.objects
             .filter(chunk_run_id=run.chunk_run_id, is_current=True)
             .exclude(pk=run.pk).update(is_current=False))
            run.is_current = True
        run.save()
        PipelineStageLog.objects.create(**_stage_log(run))

    _trace('run finalized run=%s document=%s status=%s micro=%d classified=%d '
           'unclassified=%d failed=%d review=%d calls=%d'
           % (run.id, run.document_id, run.status, run.micro_count,
              run.classified_count, run.unclassified_count, run.failed_count,
              run.review_count, run.call_count))

    from document_pipeline.pipeline_logger import log_classification_saved
    log_classification_saved(
        str(run.id),
        str(run.document_id),
        {
            'status': run.status,
            'micro_count': run.micro_count,
            'classified_count': run.classified_count,
            'review_count': run.review_count,
            'call_count': run.call_count,
            'input_tokens': run.input_tokens,
            'output_tokens': run.output_tokens,
        },
    )

    logger.info('classification run %s %s: %d micro, %d classified, %d unclassified, '
                '%d failed, %d for review, %d calls, tokens in %d / out %d / cache read %d',
                run.id, run.status, run.micro_count, run.classified_count,
                run.unclassified_count, run.failed_count, run.review_count, run.call_count,
                run.input_tokens, run.output_tokens, run.cache_read_tokens)
    return run


def fail_run(run, exc):
    """Mark an open run failed. It stays readable and never becomes current."""
    finished = timezone.now()
    with transaction.atomic():
        updated = (ClassificationRun.objects
                   .filter(pk=run.pk, status=ClassificationRun.RUNNING)
                   .update(status=ClassificationRun.FAILED, finished_at=finished,
                           duration_ms=int((finished - run.started_at).total_seconds() * 1000),
                           error_detail='%s: %s' % (type(exc).__name__, exc)))
        if updated:
            run.refresh_from_db()
            PipelineStageLog.objects.create(**_stage_log(run, error_code=type(exc).__name__))
    logger.error('classification run %s failed: %s: %s', run.id, type(exc).__name__, exc)
    _trace('run failed run=%s document=%s error=%s: %s'
           % (run.id, run.document_id, type(exc).__name__, exc))


# ------------------------------------------------------------------ inputs

def _groups_for(chunk_run, only=None):
    """Micro chunks as Groups in reading order: one group per parent, each
    carrying its parent's heading trail and opening words as section context."""
    macros = {row['clause__local_id']: row for row in
              Chunk.objects.filter(chunk_run=chunk_run, kind=Chunk.MACRO)
              .values('clause__local_id', 'breadcrumb', 'text')}
    micros = Chunk.objects.filter(chunk_run=chunk_run, kind=Chunk.MICRO)
    if only is not None:
        micros = micros.filter(id__in=list(only))

    order, members = [], {}
    for chunk in micros.only(*MICRO_FIELDS).order_by('order_index'):
        key = chunk.parent_local_id or ('root:%s' % chunk.local_id)
        if key not in members:
            order.append(key)
            members[key] = []
        members[key].append(Paragraph(
            chunk_id=str(chunk.id), local_id=chunk.local_id, order_index=chunk.order_index,
            number=chunk.clause_identifier, title=chunk.title,
            heading_trail=chunk.breadcrumb or '', lead_in=chunk.lead_in_text,
            region=chunk.region, text=chunk.text or ''))

    groups = []
    for key in order:
        parent = macros.get(key)
        groups.append(Group(
            key=key,
            section=parent['breadcrumb'] if parent else '',
            preview=prompts.preview(parent['text']) if parent else '',
            paragraphs=tuple(members[key])))
    return groups


def _context(run, vocab):
    document = run.chunk_run.extraction_run.document
    contract = document.contract
    return RunContext(
        vocab=vocab,
        schema=output_schema(vocab),
        # The prompt the run recorded, not a fresh render: every batch of a run
        # is asked exactly the same question.
        system=prompts.system_blocks(run.system_prompt),
        document_title=(run.chunk_run.extraction_run.document_title
                        or run.chunk_run.extraction_run.document_name),
        contract_type=(contract.contract_type.name if contract is not None else ''),
        max_attempts=settings.CLASSIFY_ITEM_ATTEMPTS,
    )


# ------------------------------------------------------------------ calling the model

def _execute(run, batches, *, classifier, context, workers):
    """Resolve batches on worker threads; write each as it lands, here."""
    if not batches:
        return
    pool = ThreadPoolExecutor(max_workers=min(workers, len(batches)))
    futures = [pool.submit(resolve_batch, batch, classifier=classifier, context=context)
               for batch in batches]
    try:
        for future in as_completed(futures):
            write_resolution(run, future.result(), vocab=context.vocab)
    finally:
        # On the first failure, stop queued batches from starting. Batches
        # already in flight finish and their results are discarded.
        pool.shutdown(wait=True, cancel_futures=True)


def resolve_batch(batch, *, classifier, context):
    """Ask the model about one batch until every paragraph has a result.

    Network and validation only -- never the database -- so it is safe on a
    worker thread. The retry ladder:

    - an answer cut off at max_tokens: split the batch in half and ask again
      (the cut-off call does not count against the paragraphs in it);
    - a refusal of several paragraphs: ask about each one on its own; a refusal
      of a single paragraph is final;
    - an invalid, duplicated or missing item: ask about that paragraph on its
      own, up to CLASSIFY_ITEM_ATTEMPTS requests in total, then record it as
      failed with the last error.
    """
    output_format = context.schema.output_config_format()
    attempts = {p.chunk_id: 0 for p in batch.paragraphs}
    results, calls = {}, []
    queue = [batch]
    while queue:
        sub = queue.pop(0)
        for p in sub.paragraphs:
            attempts[p.chunk_id] += 1
        text = prompts.render_user_message(sub, document_title=context.document_title,
                                           contract_type=context.contract_type)
        call = classifier.complete(context.system, text, output_format)
        _trace('LLM output batch=%d attempt=%d chunks=%s request_id=%s: %s'
               % (batch.index, max(attempts[p.chunk_id] for p in sub.paragraphs),
              ','.join(p.chunk_id for p in sub.paragraphs), call.request_id,
              call.text or ''))
        record = CallRecord(
            batch_index=batch.index, attempt=max(attempts[p.chunk_id] for p in sub.paragraphs),
            chunk_ids=[p.chunk_id for p in sub.paragraphs], status=ClassificationCall.SUCCEEDED,
            stop_reason=call.stop_reason or '', request_id=call.request_id,
            input_tokens=call.input_tokens, output_tokens=call.output_tokens,
            cache_read_tokens=call.cache_read_tokens, cache_write_tokens=call.cache_write_tokens,
            latency_ms=call.latency_ms, raw_output=call.text or '')
        calls.append(record)

        problems = {}
        if call.stop_reason == 'max_tokens':
            record.status = ClassificationCall.TRUNCATED
            record.error = 'answer cut off at max_tokens'
            if len(sub.paragraphs) > 1:
                for p in sub.paragraphs:
                    attempts[p.chunk_id] -= 1
                queue.extend(half for half in sub.halves() if half.paragraphs)
                continue
            problems = {p.chunk_id: (record.error, None) for p in sub.paragraphs}
        elif call.stop_reason == 'refusal':
            record.status = ClassificationCall.REFUSED
            record.error = 'the model declined to answer'
            if len(sub.paragraphs) > 1:
                queue.extend(batch.subset([p.chunk_id]) for p in sub.paragraphs)
                continue
            only = sub.paragraphs[0]
            results[only.chunk_id] = ItemResult(outcome=Classification.FAILED,
                                                error='refused by the model')
            continue
        else:
            valid, problems, unknown = _validate(call.text, sub, context)
            results.update(valid)
            if problems or unknown:
                record.status = ClassificationCall.INVALID
                parts = []
                if problems:
                    parts.append('%d paragraph(s) need another attempt' % len(problems))
                if unknown:
                    parts.append('ignored unknown id(s): %s' % ', '.join(unknown))
                record.error = '; '.join(parts)

        for chunk_id, (error, raw) in problems.items():
            if attempts[chunk_id] >= context.max_attempts:
                results[chunk_id] = ItemResult(outcome=Classification.FAILED, error=error,
                                               raw_item=raw)
            else:
                queue.append(batch.subset([chunk_id]))

    for chunk_id, result in results.items():
        result.attempts = max(1, attempts[chunk_id])
    return BatchResolution(batch=batch, results=results, calls=calls)


def _validate(text, sub, context):
    """A response -> (valid results, problems, unknown ids).

    problems maps chunk_id -> (error, raw item or None) for every paragraph
    that needs another attempt: invalid, answered twice, or not answered.
    """
    ids = sub.ids
    everything = lambda error: {p.chunk_id: (error, None) for p in sub.paragraphs}  # noqa: E731
    if not text:
        return {}, everything('empty response'), []
    try:
        data = json.loads(text)
    except ValueError:
        return {}, everything('response is not valid JSON'), []
    items = data.get('items') if isinstance(data, dict) else None
    if not isinstance(items, list):
        return {}, everything('response has no items list'), []

    valid, problems, unknown, seen = {}, {}, [], set()
    for raw in items:
        pid = raw.get('id') if isinstance(raw, dict) else None
        paragraph = ids.get(pid) if isinstance(pid, str) else None
        if paragraph is None:
            unknown.append(str(pid))
            continue
        chunk_id = paragraph.chunk_id
        if chunk_id in seen:
            # Two answers for one paragraph: neither can be trusted over the other.
            valid.pop(chunk_id, None)
            problems[chunk_id] = ('id %s answered more than once' % pid, raw)
            continue
        seen.add(chunk_id)
        try:
            item = context.schema.item_adapter.validate_python(raw)
        except ValidationError as exc:
            problems[chunk_id] = ('invalid answer: %s' % _brief(exc), raw)
            continue
        result = _post_process(item, raw, context.vocab)
        if isinstance(result, str):
            problems[chunk_id] = (result, raw)
        else:
            valid[chunk_id] = result
    for p in sub.paragraphs:
        if p.chunk_id not in seen:
            problems[p.chunk_id] = ('no answer for id %s' % _pid(ids, p.chunk_id), None)
    return valid, problems, unknown


def _post_process(item, raw, vocab):
    """Layer 3 for one schema-valid item. -> ItemResult, or an error string."""
    notes = []
    reason = ' '.join((item.reason or '').split())
    if not reason:
        return 'empty reason'

    if item.label == Classification.CLAUSE:
        sub_type = _clean_title(item.sub_type)
        if sub_type is None:
            notes.append('no sub_type given')
        elif len(sub_type) > 255:
            sub_type = sub_type[:255].rstrip()
            notes.append('sub_type truncated to 255 characters')
        if item.canonical_type is None:
            return ItemResult(outcome=Classification.UNCLASSIFIED, label=Classification.CLAUSE,
                              sub_type=sub_type, confidence=item.confidence, reason=reason,
                              raw_item=raw, notes=notes)
        entry = vocab.canonicalize(item.canonical_type, applies_to=CLAUSE)
        if entry is None:
            return 'canonical_type %r is not a clause type' % item.canonical_type
        if entry.name != item.canonical_type:
            notes.append('canonical_type %r resolved to %r' % (item.canonical_type, entry.name))
        return ItemResult(outcome=Classification.CLASSIFIED, label=Classification.CLAUSE,
                          type_key=entry.key, sub_type=sub_type, confidence=item.confidence,
                          reason=reason, raw_item=raw, notes=notes)

    entry = vocab.canonicalize(item.canonical_type, applies_to=NON_CLAUSE)
    if entry is None:
        return 'canonical_type %r is not a non-clause type' % item.canonical_type
    if entry.name != item.canonical_type:
        notes.append('canonical_type %r resolved to %r' % (item.canonical_type, entry.name))
    return ItemResult(outcome=Classification.CLASSIFIED, label=Classification.NON_CLAUSE,
                      type_key=entry.key, sub_type=None, confidence=item.confidence,
                      reason=reason, raw_item=raw, notes=notes)


def _clean_title(value):
    text = ' '.join((value or '').split()).strip('"\'').rstrip('.:;,').strip()
    return text or None


def _brief(exc):
    errors = exc.errors()
    first = errors[0] if errors else {}
    where = '.'.join(str(part) for part in first.get('loc', ()))
    return '%s%s' % (('%s: ' % where) if where else '', first.get('msg', str(exc)))


def _pid(ids, chunk_id):
    return next((pid for pid, p in ids.items() if p.chunk_id == chunk_id), '?')


# ------------------------------------------------------------------ writing

def write_resolution(run, resolution, *, vocab):
    """One resolved batch -> Classification and ClassificationCall rows, in one
    transaction. Paragraphs that already have a row in the run are skipped."""
    batch = resolution.batch
    type_pks = dict(CanonicalType.objects.filter(version=vocab.version)
                    .values_list('key', 'id'))
    chunk_ids = [p.chunk_id for p in batch.paragraphs]
    existing = {str(pk) for pk in Classification.objects.filter(
        run=run, chunk_id__in=chunk_ids).values_list('chunk_id', flat=True)}
    # Read here rather than off the Paragraph: batching carries what the model
    # is shown, and the paragraph ids are never shown to it.
    para_ids = {str(pk): ids for pk, ids in
                Chunk.objects.filter(id__in=chunk_ids)
                .values_list('id', 'paragraph_ids')}
    high_risk = set(settings.CLASSIFY_HIGH_RISK_TYPES)
    threshold = settings.CLASSIFY_CONFIDENCE_THRESHOLD

    rows = []
    for group in batch.groups:
        for paragraph in group.paragraphs:
            if paragraph.chunk_id in existing:
                continue
            result = resolution.results.get(paragraph.chunk_id) or ItemResult(
                outcome=Classification.FAILED, error='no result was produced')
            expected = vocab.expected_keys(group.section, paragraph.title or '')
            _trace('clause chunk=%s outcome=%s label=%s type=%s confidence=%s'
                   % (paragraph.chunk_id, result.outcome, result.label or '',
                      result.type_key or '', result.confidence))
            rows.append(_row(run, paragraph, result, expected, batch.index, type_pks,
                             high_risk, threshold, para_ids.get(paragraph.chunk_id) or []))
    calls = [ClassificationCall(
        run=run, document_id=run.document_id, batch_index=c.batch_index, attempt=c.attempt,
        chunk_ids=c.chunk_ids,
        item_count=len(c.chunk_ids), status=c.status, stop_reason=c.stop_reason,
        request_id=c.request_id, input_tokens=c.input_tokens, output_tokens=c.output_tokens,
        cache_read_tokens=c.cache_read_tokens, cache_write_tokens=c.cache_write_tokens,
        latency_ms=c.latency_ms, raw_output=c.raw_output, error=c.error)
        for c in resolution.calls]

    _trace('DB upsert prepared run=%s document=%s classifications=%d calls=%d'
           % (run.id, run.document_id, len(rows), len(calls)))

    try:
        with transaction.atomic():
            Classification.objects.bulk_create(rows, batch_size=settings.CLASSIFY_BULK_BATCH_SIZE)
            ClassificationCall.objects.bulk_create(calls)
    except Exception as exc:
        _trace('DB upsert FAILED and rolled back run=%s document=%s error=%s: %s'
               % (run.id, run.document_id, type(exc).__name__, exc))
        raise
    _trace('DB upsert committed run=%s document=%s classifications=%d calls=%d'
           % (run.id, run.document_id, len(rows), len(calls)))
    return rows


def _row(run, paragraph, result, expected, batch_index, type_pks, high_risk, threshold,
         paragraph_ids):
    """An ItemResult plus the computed checks -> an unsaved Classification."""
    classified_clause = (result.outcome == Classification.CLASSIFIED
                         and result.label == Classification.CLAUSE)
    deviated = bool(classified_clause and expected and result.type_key not in expected)

    reasons = []
    if result.outcome == Classification.FAILED:
        reasons.append(Classification.REVIEW_FAILED)
    elif result.outcome == Classification.UNCLASSIFIED:
        reasons.append(Classification.REVIEW_UNCLASSIFIED)
    if result.confidence is not None and result.confidence < threshold:
        reasons.append(Classification.LOW_CONFIDENCE)
    if result.type_key in high_risk:
        reasons.append(Classification.HIGH_RISK)
    if deviated:
        reasons.append(Classification.DEVIATED)

    failed = result.outcome == Classification.FAILED
    return Classification(
        run=run,
        document_id=run.document_id,
        chunk_id=paragraph.chunk_id,
        paragraph_ids=paragraph_ids,
        outcome=result.outcome,
        label=None if failed else result.label,
        canonical_type_id=type_pks[result.type_key] if result.type_key else None,
        sub_type=result.sub_type,
        confidence=None if failed else result.confidence,
        expected_type_keys=expected,
        deviated=deviated,
        needs_review=bool(reasons),
        review_reasons=reasons,
        batch_index=batch_index,
        call_attempts=result.attempts,
        raw_item=result.raw_item,
        validation_notes=result.notes,
        error=result.error,
    )


def _reason_counts(rows):
    counts = {}
    for reasons in rows.filter(needs_review=True).values_list('review_reasons', flat=True):
        for reason in reasons:
            counts[reason] = counts.get(reason, 0) + 1
    return dict(sorted(counts.items()))


def _stage_log(run, error_code=''):
    finished = run.finished_at or timezone.now()
    duration = run.duration_ms or 0
    status = {
        ClassificationRun.SUCCEEDED: 'succeeded',
        ClassificationRun.SUCCEEDED_WITH_WARNINGS: 'succeeded_with_warnings',
    }.get(run.status, 'failed')
    return dict(
        document_id=run.document_id, extraction_run_id=run.chunk_run.extraction_run_id,
        stage='classify', status=status, attempt=run.attempt, duration_ms=duration,
        started_at=finished - timedelta(milliseconds=duration), finished_at=finished,
        error_code=error_code, error_detail=run.error_detail,
        payload={
            'classification_run': str(run.id),
            'model': run.model_id,
            'taxonomy_version': run.taxonomy_version,
            'prompt_version': run.prompt_version,
            'micro': run.micro_count,
            'classified': run.classified_count,
            'unclassified': run.unclassified_count,
            'failed': run.failed_count,
            'review': run.review_count,
            'calls': run.call_count,
            'input_tokens': run.input_tokens,
            'output_tokens': run.output_tokens,
            'cache_read_tokens': run.cache_read_tokens,
        },
    )
