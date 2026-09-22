"""What the pipeline holds for one document, as JSON a person can read.

Three views of a document's current runs:

  extraction            the clause tree and every paragraph, with the breadcrumb
                        each one carries. For checking the parser.
  classification input  the micro chunks exactly as the classifier receives them,
                        grouped by section. Built with the classifier's own
                        grouping, so what you read here is what it reads.
  classification        the verdict on every micro chunk: label, type, sub-type,
                        confidence, and why it is flagged for review.

Written to PIPELINE_EXPORT_DIR/<document name>__<document id>/ and served by
the document endpoints. Contract text is client data: the export directory is
git-ignored and must stay that way.
"""
import json
import re
from collections import Counter
from pathlib import Path

from django.conf import settings

from document_pipeline.models import (
    ChunkRun,
    Classification,
    ClassificationRun,
    ExtractedClause,
    ExtractedParagraph,
)
from document_pipeline.services.classification_service import _groups_for
from document_pipeline.services.review_service import current_reviews_for_run, review_json

EXTRACTION_FILE = 'extraction.json'
CLASSIFICATION_FILE = 'classification_input.json'
CLASSIFICATION_OUTPUT_FILE = 'classification.json'


def current_chunk_run(document):
    run = document.current_run
    if run is None:
        return None
    return ChunkRun.objects.filter(extraction_run=run, is_current=True).first()


def _document_header(document, run):
    return {
        'document_id': str(document.id),
        'name': document.name,
        'title': (run.document_title if run else None) or document.document_title,
        'drive_file_id': document.source_external_id,
        'drive_folder_id': document.source_parent_id,
        'extraction_status': document.extraction_status,
    }


def extraction_json(document):
    """The current extraction run: clauses in reading order, then paragraphs."""
    run = document.current_run
    if run is None:
        return {'document': _document_header(document, None), 'extraction': None}

    local_by_pk = dict(ExtractedClause.objects.filter(run=run).values_list('id', 'local_id'))
    clauses = [{
        'clause_id': c.local_id,
        'parent_id': local_by_pk.get(c.parent_id),
        'level': c.level,
        'number': c.display_number,
        'title': c.clause_title,
        'path': c.full_path,
        'source': c.numbering_source,
        'confidence': c.confidence,
        'flags': c.flags,
        'text': c.text,
        'body_text': c.body_text,
    } for c in ExtractedClause.objects.filter(run=run).order_by('order_index')]

    paragraphs = [{
        'paragraph_id': p.local_id,
        'page': p.page_number,
        'bucket': p.bucket,
        'clause_id': local_by_pk.get(p.clause_id),
        'breadcrumb': ' > '.join(p.breadcrumbs or []),
        'text': p.text,
    } for p in ExtractedParagraph.objects.filter(run=run).order_by('sequence_order')]

    return {
        'document': _document_header(document, run),
        'extraction': {
            'run_id': str(run.id),
            'attempt': run.attempt,
            'status': run.status,
            'parser_build': run.parser_build,
            'extracted_at': run.extracted_at.isoformat(),
            'page_count': run.page_count,
            'clause_count': run.clause_count,
            'paragraph_count': run.paragraph_count,
            'max_level': run.max_level,
            'warnings': run.warning_codes,
            'rejection': run.rejection,
        },
        'clauses': clauses,
        'paragraphs': paragraphs,
    }


def classification_input_json(document):
    """The micro chunks of the current chunk run, grouped the way the
    classifier batches them. Ids are chunk ids, not the per-batch ids a single
    request uses."""
    chunk_run = current_chunk_run(document)
    run = document.current_run
    if chunk_run is None:
        return {'document': _document_header(document, run), 'chunk_run': None, 'groups': []}

    contract = document.contract
    groups = []
    for group in _groups_for(chunk_run):
        section = {}
        if group.section:
            section['section'] = group.section
        if group.preview:
            section['section_opening'] = group.preview
        section['paragraphs'] = [_paragraph(p) for p in group.paragraphs]
        groups.append(section)

    return {
        'document': dict(_document_header(document, run),
                         contract_type=contract.contract_type.name if contract else None),
        'chunk_run': {
            'chunk_run_id': str(chunk_run.id),
            'chunker_version': chunk_run.chunker_version,
            'chunk_count': chunk_run.chunk_count,
            'micro_count': chunk_run.micro_count,
            'macro_count': chunk_run.macro_count,
            'all_clauses_covered': chunk_run.all_clauses_covered,
            'all_paragraphs_covered': chunk_run.all_paragraphs_covered,
        },
        'groups': groups,
    }


def current_classification_run(document):
    chunk_run = current_chunk_run(document)
    if chunk_run is None:
        return None
    return ClassificationRun.objects.filter(chunk_run=chunk_run, is_current=True).first()


def classification_json(document):
    """The current classification run: a summary, then one entry per micro chunk
    in reading order with the verdict and why it needs review."""
    run = document.current_run
    classification_run = current_classification_run(document)
    header = _document_header(document, run)
    if classification_run is None:
        return {'document': header, 'classification_run': None, 'summary': None, 'items': []}

    rows = (Classification.objects.filter(run=classification_run)
            .select_related('chunk', 'chunk__clause', 'canonical_type')
            .order_by('chunk__order_index'))
    # Every decision made against this run, in one query rather than one per
    # item. An item nobody has decided on carries review: null.
    reviews = current_reviews_for_run(classification_run)
    items, by_type, by_outcome, by_decision = [], Counter(), Counter(), Counter()
    for c in rows:
        chunk = c.chunk
        type_name = c.canonical_type.name if c.canonical_type else None
        by_outcome[c.outcome] += 1
        by_type['%s: %s' % (c.label, type_name) if c.label else 'failed'] += 1
        review = reviews.get(c.id)
        if review is not None:
            by_decision[review.decision] += 1
        items.append({
            # The handle a review decision is posted against. Stable across
            # requests, unlike clause_id, which is local to an extraction run.
            'classification_id': str(c.id),
            'clause_id': chunk.clause.local_id,
            # The source paragraphs behind the verdict, so a reader can point
            # at the exact text. Several per clause is normal.
            'paragraph_ids': c.paragraph_ids,
            'number': chunk.clause_identifier,
            # The section trail this clause sits under.
            'breadcrumb': chunk.breadcrumb,
            'text': chunk.text,
            'outcome': c.outcome,
            'label': c.label,
            'type': c.canonical_type.key if c.canonical_type else None,
            'type_name': type_name,
            'sub_type': c.sub_type,
            'confidence': c.confidence,
            'needs_review': c.needs_review,
            'review_reasons': c.review_reasons,
            'expected_types': c.expected_type_keys,
            'deviated': c.deviated,
            'error': c.error or None,
            'review': review_json(review),
        })

    r = classification_run
    return {
        'document': header,
        'classification_run': {
            'classification_run_id': str(r.id),
            'status': r.status,
            'attempt': r.attempt,
            'model_id': r.model_id,
            'taxonomy_version': r.taxonomy_version,
            'prompt_version': r.prompt_version,
            'started_at': r.started_at.isoformat() if r.started_at else None,
            'duration_ms': r.duration_ms,
            'calls': r.call_count,
            'tokens': {'input': r.input_tokens, 'output': r.output_tokens,
                       'cache_read': r.cache_read_tokens, 'cache_write': r.cache_write_tokens},
            'error': r.error_detail or None,
        },
        'summary': {
            'micro_chunks': r.micro_count,
            'classified': r.classified_count,
            'unclassified': r.unclassified_count,
            'failed': r.failed_count,
            'needs_review': r.review_count,
            'by_outcome': dict(by_outcome),
            'by_type': dict(by_type.most_common()),
            # Review progress over the whole run, so a header can read
            # "41 of 338 reviewed" without the client counting items itself.
            'review': _review_progress(by_decision, len(items)),
        },
        'items': items,
    }


def _review_progress(by_decision, total):
    """How far the human pass has got. Always present, zeroed when nobody has
    decided anything yet -- a count of zero is a fact, unlike a stage that has
    not run, so this is never null."""
    reviewed = sum(by_decision.values())
    return {
        'reviewed': reviewed,
        'pending': total - reviewed,
        'accepted': by_decision.get('accepted', 0),
        'corrected': by_decision.get('corrected', 0),
        'rejected': by_decision.get('rejected', 0),
    }


def _paragraph(p):
    # A chunk's local id is chunk_<clause local id>_<kind> (chunking/builder.py),
    # which ties the entry back to the clause in extraction.json.
    entry = {'chunk_id': p.chunk_id, 'clause_id': p.local_id.removeprefix('chunk_').rsplit('_', 1)[0]}
    if p.number:
        entry['number'] = p.number
    if p.title:
        entry['title'] = p.title
    if p.heading_trail:
        entry['heading_trail'] = p.heading_trail
    if p.lead_in:
        entry['lead_in'] = p.lead_in
    if p.region and p.region != 'body':
        entry['region'] = p.region
    entry['text'] = p.text
    return entry


def export_dir():
    return Path(settings.PIPELINE_EXPORT_DIR)


def document_dir(document):
    """<name>__<id prefix>. The name is cut short because Windows refuses paths
    over 260 characters, and Drive names can run past a hundred on their own;
    the id prefix keeps two documents with the same leading name apart."""
    stem = re.sub(r'[^A-Za-z0-9._ -]+', '_', document.name or 'document')
    stem = stem.removesuffix('.docx')[:40].strip(' ._')
    return export_dir() / ('%s__%s' % (stem or 'document', str(document.id)[:8]))


def write_exports(document):
    """Write every view the document has so far. -> {view: path}

    classification.json is written only once a classification run exists, and
    removed when there is none, so a stale verdict never sits beside a new parse."""
    folder = document_dir(document)
    folder.mkdir(parents=True, exist_ok=True)
    views = [('extraction', EXTRACTION_FILE, extraction_json),
             ('classification_input', CLASSIFICATION_FILE, classification_input_json)]
    output = folder / CLASSIFICATION_OUTPUT_FILE
    if current_classification_run(document) is not None:
        views.append(('classification', CLASSIFICATION_OUTPUT_FILE, classification_json))
    elif output.exists():
        output.unlink()
    paths = {}
    for key, name, build in views:
        path = folder / name
        path.write_text(json.dumps(build(document), ensure_ascii=False, indent=2), encoding='utf-8')
        paths[key] = str(path)
    return paths
