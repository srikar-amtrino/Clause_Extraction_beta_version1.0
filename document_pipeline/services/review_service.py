"""The review screen's Save: what a reviewer did to a document's items.

Each item is one Classification row, and Save updates that row in place. The
model's answer stays in label / canonical_type / sub_type; what the reviewer
saves goes into the row's review columns and `text`. Saving again overwrites
those columns and never adds a row. Who changed what, from what, is written to
the document's activity log, one event per Save.

Every rejected payload raises ReviewError carrying a sentence meant to be read
by the person who caused it. The view turns that into a 400 without knowing
anything about the rules.
"""
import uuid

from django.db import transaction
from django.db.models import Count

from document_pipeline.models import CanonicalType, Classification

C = Classification

LABELS = {C.CLAUSE: CanonicalType.CLAUSE, C.NON_CLAUSE: CanonicalType.NON_CLAUSE}

# The row's review columns, as one Save writes them.
REVIEW_FIELDS = ['text', 'review_decision', 'reviewed_label', 'reviewed_canonical_type',
                 'reviewed_sub_type', 'review_note', 'reviewed_by', 'reviewed_at']


class ReviewError(ValueError):
    """A payload the reviewer has to fix. The message is user-facing."""


class SaveError(ReviewError):
    """A Save the reviewer has to fix. Carries the per-item problems and the
    HTTP status the view answers with."""

    def __init__(self, detail, *, status=400, errors=None, extra=None):
        super().__init__(detail)
        self.status = status
        self.errors = errors or []
        self.extra = extra or {}


def _blank(value):
    """None for a value that means "nothing": missing, empty, or the literal
    'null' a dropdown hands back."""
    if not isinstance(value, str):
        return value
    value = value.strip()
    return None if value in ('', 'null', 'None') else value


def _is_uuid(value):
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _resolve_type(key, label, taxonomy_version):
    """The canonical type a correction names, in the version the run used.

    Looked up in that version rather than the newest, so a correction can only
    name a type the verdict itself could have carried.
    """
    canonical_type = CanonicalType.objects.filter(version=taxonomy_version, key=key).first()
    if canonical_type is None:
        raise ReviewError('No type "%s" in taxonomy %s.' % (key, taxonomy_version))
    if not canonical_type.is_active:
        raise ReviewError('Type "%s" is retired and cannot be assigned.' % key)
    if canonical_type.applies_to != LABELS[label]:
        raise ReviewError('Type "%s" is a %s type; a %s cannot take it.'
                          % (key, canonical_type.applies_to.replace('_', '-'), label))
    return canonical_type


# ------------------------------------------------------------------ reading

def current_verdict(classification):
    """-> (label, CanonicalType | None, sub_type): the item as it stands.

    The reviewer's saved verdict once there is one -- empty for a rejection --
    and the model's answer until then.
    """
    c = classification
    if c.review_decision:
        return c.reviewed_label, c.reviewed_canonical_type, c.reviewed_sub_type
    return c.label, c.canonical_type, c.sub_type


def current_text(classification):
    """The clause text as it stands: the reviewer's edit, else the source."""
    if classification.text is not None:
        return classification.text
    return classification.chunk.text


def review_json(classification):
    """The item's saved review as the API returns it, or None while nobody has
    saved it -- the same not-yet shape the stage summaries use."""
    c = classification
    if not c.review_decision:
        return None
    user = c.reviewed_by
    return {
        'decision': c.review_decision,
        'note': c.review_note or None,
        'text_edited': current_text(c) != c.chunk.text,
        'reviewed_by': user.email if user else None,
        'reviewed_by_name': user.username if user else None,
        'reviewed_at': c.reviewed_at.isoformat() if c.reviewed_at else None,
    }


def review_counts_by_run(run_ids):
    """-> {run_id: {decision: count}} for a page of documents, in one query.

    The list endpoint shows review progress per row; without this it would be
    a query per row.
    """
    counts = {}
    rows = (Classification.objects
            .filter(run_id__in=run_ids, review_decision__isnull=False)
            .values('run_id', 'review_decision')
            .annotate(total=Count('id')))
    for row in rows:
        counts.setdefault(row['run_id'], {})[row['review_decision']] = row['total']
    return counts


# ------------------------------------------------------------------ one entry

def _decision_for(classification, entry):
    """One Save entry -> (decision, label, type key, sub_type, note).

    The client sends the values the row shows now; which of accepted or
    corrected that is gets worked out here by comparing them with the model's
    answer, so no client has to know the rule. A field it leaves out keeps the
    value the row already has.
    """
    c = classification
    note = entry.get('note')
    if note is not None and not isinstance(note, str):
        raise ReviewError('note must be text.')
    note = (note or '').strip()

    if _blank(entry.get('decision')) == C.REJECTED:
        if not note:
            raise ReviewError('A rejected verdict needs a note saying what is wrong with it.')
        return C.REJECTED, None, None, None, note

    label, canonical_type, sub_type = current_verdict(c)
    if c.review_decision == C.REJECTED:
        # Nothing to fall back on once rejected: start from the model's answer.
        label, canonical_type, sub_type = c.label, c.canonical_type, c.sub_type
    for key in ('label', 'type', 'sub_type'):
        if key in entry and entry[key] is not None and not isinstance(entry[key], str):
            raise ReviewError('%s must be text.' % key)
    label = _blank(entry['label']) if 'label' in entry else label
    type_key = (_blank(entry['type']) if 'type' in entry
                else (canonical_type.key if canonical_type else None))
    sub_type = _blank(entry['sub_type']) if 'sub_type' in entry else _blank(sub_type)
    if label == C.NON_CLAUSE:
        sub_type = None

    model = (c.label, c.canonical_type.key if c.canonical_type else None, _blank(c.sub_type))
    if (label, type_key, sub_type) == model:
        if c.label is None:
            raise ReviewError('The classifier gave this item no answer to accept. '
                              'Choose a label and a type.')
        return C.ACCEPTED, label, type_key, sub_type, note
    if label not in LABELS:
        raise ReviewError('Unknown label "%s". Use %s | %s.' % (label, C.CLAUSE, C.NON_CLAUSE))
    if type_key is None:
        raise ReviewError('A corrected verdict needs the type it should have had.')
    return C.CORRECTED, label, type_key, sub_type, note


def _text_for(classification, entry):
    if 'text' not in entry:
        return current_text(classification)
    text = entry['text']
    if not isinstance(text, str) or not text.strip():
        raise ReviewError('text cannot be empty.')
    return text


def _state(classification):
    """The item as it stands, for telling a real change from a repeat and for
    the history: before a first Save that is the model's answer, which is what
    the reviewer was looking at when they changed it."""
    c = classification
    label, canonical_type, sub_type = current_verdict(c)
    return {
        'decision': c.review_decision,
        'label': label,
        'type': canonical_type.key if canonical_type else None,
        'sub_type': sub_type,
        'note': c.review_note or '',
        'text': current_text(c),
    }


def _changes(classification, before, after):
    """What one Save changed on one item, for the activity log: the fields that
    moved, each with its value before and after."""
    shown = {'decision': 'decision', 'label': 'label', 'type': 'type',
             'sub_type': 'sub_type', 'note': 'note', 'text': 'text'}
    moved = {name: {'from': before[key], 'to': after[key]}
             for key, name in shown.items() if before[key] != after[key]}
    return {'classification_id': str(classification.id),
            'clause_id': classification.chunk.clause.local_id,
            'changes': moved}


# ------------------------------------------------------------------ save

def _next_review_status(current, all_reviewed):
    reopened = current in ('published', 'reopened_in_review', 'reopened_reviewed')
    if all_reviewed:
        return 'reopened_reviewed' if reopened else 'reviewed'
    return 'reopened_in_review' if reopened else 'in_review'


def _mirror(document, classification, user, now):
    """Copy one saved item onto the document's paragraph record, the table
    Update Vector DB reads. Created when finalize never materialised it, so a
    Save never depends on which path classified the document."""
    from document_pipeline.models import DocumentParagraphRecord

    c = classification
    chunk = c.chunk
    record, _ = DocumentParagraphRecord.objects.get_or_create(
        document_id=document.id, paragraph_id=chunk.local_id,
        defaults={
            'chunk': chunk, 'classification': c,
            'breadcrumb': chunk.breadcrumb.split(' > ') if chunk.breadcrumb else [],
            'sequence_order': chunk.order_index,
            'original_text': chunk.text, 'reviewed_text': chunk.text,
            'confidence': c.confidence,
            'llm_issues': c.review_reasons or [],
        })
    label, canonical_type, sub_type = current_verdict(c)
    values = (label or c.label or DocumentParagraphRecord.CLAUSE,
              canonical_type.key if canonical_type else '',
              sub_type or '',
              current_text(c))
    changed = (record.label, record.canonical_type, record.sub_type,
               record.reviewed_text) != values
    record.chunk = chunk
    record.classification = c
    record.label, record.canonical_type, record.sub_type, record.reviewed_text = values
    record.is_reviewed = True
    record.reviewed_by = user
    # Pending for the vector DB when its values moved, or when it has never
    # been synced at all. A verdict accepted unchanged after a sync is not.
    record.is_modified = record.is_modified or changed or record.last_synced_at is None
    if changed:
        record.last_edited_by = user
        record.last_edited_at = now
    record.save()


@transaction.atomic
def save_document(document, classification_run_id, items, user):
    """The Save button: store what the reviewer did to one document.

    Only the items sent are touched, each on its own row. Every entry is
    checked before anything is written, so a Save lands whole or not at all.
    An entry identical to what the row already holds is counted as unchanged
    and writes nothing, so pressing Save twice leaves no trace. Nothing is sent
    to the vector DB: saved items are marked pending, and Update Vector DB
    picks them up.

    -> {'saved': {accepted, corrected, rejected, unchanged},
        'classification_ids': [...], 'review_status': str}
    """
    from django.utils import timezone

    from document_pipeline.activity import log_activity
    from document_pipeline.models import Document, DocumentActivityLog
    from document_pipeline.services.export_service import current_classification_run

    # Two Saves on one document queue here rather than interleaving.
    Document.objects.select_for_update().filter(pk=document.pk).first()

    run = current_classification_run(document)
    if run is None:
        raise SaveError('This document has no classification to save.')
    if not classification_run_id:
        raise SaveError('classification_run_id is required: send the one '
                        'GET /classification/ returned.')
    if str(classification_run_id) != str(run.id):
        raise SaveError('This document was re-classified after you opened it. Reload it '
                        'and make your changes again.', status=409,
                        extra={'classification_run_id': str(run.id)})
    if not isinstance(items, list) or not items:
        raise SaveError('items must be a non-empty list.')

    errors, wanted = [], []
    for index, entry in enumerate(items):
        cid = entry.get('classification_id') if isinstance(entry, dict) else None
        if not cid or not _is_uuid(cid):
            errors.append({'index': index, 'classification_id': cid,
                           'detail': 'Each item needs a classification_id (a UUID).'})
            continue
        wanted.append((str(cid), entry))
    ids = [cid for cid, _ in wanted]
    if len(set(ids)) != len(ids):
        raise SaveError('The same classification appears twice in one Save.')

    rows = {str(c.id): c for c in (Classification.objects
                                   .filter(run=run, id__in=ids)
                                   .select_related('chunk', 'chunk__clause', 'canonical_type',
                                                   'reviewed_canonical_type', 'run'))}

    now = timezone.now()
    counts = {'accepted': 0, 'corrected': 0, 'rejected': 0, 'unchanged': 0}
    changed, log = [], []
    for cid, entry in wanted:
        c = rows.get(cid)
        if c is None:
            errors.append({'classification_id': cid,
                           'detail': "Not part of this document's current classification."})
            continue
        try:
            decision, label, type_key, sub_type, note = _decision_for(c, entry)
            canonical_type = (_resolve_type(type_key, label, run.taxonomy_version)
                              if type_key else None)
            text = _text_for(c, entry)
        except ReviewError as problem:
            errors.append({'classification_id': cid, 'detail': str(problem)})
            continue
        before = _state(c)
        after = {'decision': decision, 'label': label,
                 'type': canonical_type.key if canonical_type else None,
                 'sub_type': sub_type, 'note': note, 'text': text}
        if before == after:
            counts['unchanged'] += 1
            continue
        counts[decision] += 1
        log.append(_changes(c, before, after))
        c.text = text
        c.review_decision = decision
        c.reviewed_label = label
        c.reviewed_canonical_type = canonical_type
        c.reviewed_sub_type = sub_type
        c.review_note = note
        c.reviewed_by = user
        c.reviewed_at = now
        changed.append(c)

    if errors:
        raise SaveError('%d item(s) could not be saved, so nothing was saved.' % len(errors),
                        errors=errors)

    if changed:
        Classification.objects.bulk_update(changed, REVIEW_FIELDS)
    for cid in ids:
        _mirror(document, rows[cid], user, now)

    reviewed = Classification.objects.filter(run=run, review_decision__isnull=False).count()
    total = Classification.objects.filter(run=run).count()
    document.refresh_from_db(fields=['review_status'])
    status = _next_review_status(document.review_status, reviewed >= total)
    if status != document.review_status:
        Document.objects.filter(pk=document.pk).update(review_status=status)

    if changed:
        parts = ['%d %s' % (counts[k], k) for k in ('accepted', 'corrected', 'rejected')
                 if counts[k]]
        log_activity(
            document_id=document.id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=DocumentActivityLog.ACT_SAVED,
            summary='%s saved %d item(s): %s.' % (user.username, len(changed), ', '.join(parts)),
            actor_user=user,
            metadata=dict(counts, classification_run_id=str(run.id),
                          reviewed=reviewed, total=total, items=log),
        )

    return {'saved': counts, 'classification_ids': ids, 'review_status': status}


def fill_text(run):
    """Copy each item's source text onto its classification row, where a row
    written by the classifier has none, so the classifications table reads on
    its own. A reviewer's edit is never overwritten."""
    from django.db.models import OuterRef, Subquery
    from document_pipeline.models import Chunk

    return (Classification.objects
            .filter(run=run, text__isnull=True)
            .update(text=Subquery(Chunk.objects.filter(pk=OuterRef('chunk_id'))
                                  .values('text')[:1])))


def vector_sync_state(document):
    """-> what Update Vector DB would pick up now, for enabling its button.

    pending_changes counts saved items the vector DB does not have yet: every
    saved item before the first sync, then only the ones whose values changed.
    """
    from document_pipeline.models import DocumentParagraphRecord, VectorSyncRun

    last = (VectorSyncRun.objects
            .filter(document_id=document.id, status=VectorSyncRun.SUCCEEDED)
            .order_by('-started_at').first())
    return {
        'pending_changes': DocumentParagraphRecord.objects.filter(
            document_id=document.id, is_modified=True).count(),
        'last_synced_at': (last.finished_at or last.started_at).isoformat() if last else None,
    }
