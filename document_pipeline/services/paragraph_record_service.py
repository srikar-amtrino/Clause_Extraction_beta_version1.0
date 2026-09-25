"""Service: materialise DocumentParagraphRecord rows after classification.

Called by the finalize task once the classification run has succeeded.
Creates one row per micro-chunk, copying the classification verdict and
the source paragraph text so the review workspace can read from a single
Postgres table rather than joining six others.

If records for this document already exist (e.g. a re-run) they are
left-updated: fields that the reviewer may have edited (reviewed_text,
is_reviewed) are NOT overwritten.
"""
import logging

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


def _trace(message):
    print('[REVIEW WORKSPACE] %s' % message, flush=True)


def materialise_paragraph_records(document_id) -> dict:
    """Create or refresh DocumentParagraphRecord rows for *document_id*.

    Returns a stats dict:
        {total, created, updated, flagged}
    """
    from document_pipeline.models import (
        Chunk,
        Classification,
        ClassificationRun,
        Document,
        DocumentParagraphRecord,
    )

    doc = Document.objects.select_related().get(pk=document_id)
    current_run = (
        ClassificationRun.objects.filter(document=doc, is_current=True)
        .order_by('-created_at')
        .first()
    )
    if not current_run:
        logger.warning(
            'materialise_paragraph_records: no current classification run for %s',
            document_id,
        )
        return {'total': 0, 'created': 0, 'updated': 0, 'flagged': 0}

    classifications = (
        Classification.objects
        .filter(run=current_run)
        .select_related('chunk', 'canonical_type')
        .order_by('chunk__order_index')
    )

    created = updated = flagged = 0

    with transaction.atomic():
        for idx, clf in enumerate(classifications):
            chunk = clf.chunk
            para_id = chunk.local_id  # e.g. "chunk_c14_micro"

            defaults_on_create = {
                'chunk': chunk,
                'classification': clf,
                'breadcrumb': chunk.breadcrumb.split(' > ') if chunk.breadcrumb else [],
                'source_page': 1,
                'sequence_order': idx,
                'original_text': chunk.text,
                'reviewed_text': chunk.text,
                'label': clf.label or 'Clause',
                'canonical_type': (
                    clf.canonical_type.key if clf.canonical_type else ''
                ),
                'sub_type': clf.sub_type or '',
                'confidence': clf.confidence,
                'llm_issues': clf.review_reasons or [],
                'is_reviewed': False,
                'is_modified': False,
            }

            record, was_created = DocumentParagraphRecord.objects.get_or_create(
                document_id=document_id,
                paragraph_id=para_id,
                defaults=defaults_on_create,
            )

            if was_created:
                created += 1
                _trace('paragraph created document=%s paragraph=%s classification=%s '
                       'needs_review=%s reasons=%s'
                       % (document_id, para_id, clf.id, clf.needs_review,
                          clf.review_reasons))
            else:
                # Refresh LLM-owned fields but preserve reviewer edits.
                record.llm_issues = clf.review_reasons or []
                record.confidence = clf.confidence
                # Only reset classification fields if no human has edited yet.
                if not record.is_reviewed:
                    record.label = clf.label or 'Clause'
                    record.canonical_type = (
                        clf.canonical_type.key if clf.canonical_type else ''
                    )
                    record.sub_type = clf.sub_type or ''
                record.save(update_fields=[
                    'llm_issues', 'confidence', 'label',
                    'canonical_type', 'sub_type',
                ])
                updated += 1
                _trace('paragraph updated document=%s paragraph=%s record=%s '
                       'needs_review=%s reasons=%s'
                       % (document_id, para_id, record.id, clf.needs_review,
                          clf.review_reasons))

            if clf.needs_review:
                flagged += 1

    total = created + updated
    logger.info(
        'materialise_paragraph_records: doc=%s total=%d created=%d updated=%d flagged=%d',
        document_id, total, created, updated, flagged,
    )
    _trace('paragraph upsert committed document=%s total=%d created=%d updated=%d flagged=%d'
           % (document_id, total, created, updated, flagged))
    return {'total': total, 'created': created, 'updated': updated, 'flagged': flagged}
