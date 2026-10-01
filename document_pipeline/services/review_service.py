"""Recording what a reviewer decided about a classification.

One entry point, `record_decision`, used by both the single and the bulk
endpoint, so a decision made on its own and a decision made in a batch of forty
go through exactly the same validation.

Every rejected payload raises ReviewError carrying a sentence meant to be read
by the person who caused it. The view turns that into a 400 without knowing
anything about the rules.
"""
import uuid

from django.db import transaction
from django.db.models import Count, Max

from document_pipeline.models import CanonicalType, Classification, ClassificationReview

DECISIONS = {ClassificationReview.ACCEPTED,
             ClassificationReview.CORRECTED,
             ClassificationReview.REJECTED}

LABELS = {ClassificationReview.CLAUSE: CanonicalType.CLAUSE,
          ClassificationReview.NON_CLAUSE: CanonicalType.NON_CLAUSE}


class ReviewError(ValueError):
    """A payload the reviewer has to fix. The message is user-facing."""


def reviewer_from_session(request):
    """-> (email, name). The signed-in Drive account, or (None, None).

    Read from the session, never from the request body: a reviewer name the
    client gets to choose is worth nothing in an audit trail.
    """
    user = request.session.get('google_drive_user') or {}
    return user.get('email') or None, user.get('name') or None


def _string(payload, key):
    value = payload.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ReviewError('%s must be text.' % key)
    return value.strip() or None


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


def validate(classification, payload):
    """-> the fields a ClassificationReview needs, or raise ReviewError.

    Split out from the write so the bulk endpoint can check a whole batch
    before it commits any of it.
    """
    if not isinstance(payload, dict):
        raise ReviewError('Each decision must be an object.')

    decision = _string(payload, 'decision')
    if decision is None:
        raise ReviewError('decision is required: %s.' % ' | '.join(sorted(DECISIONS)))
    if decision not in DECISIONS:
        raise ReviewError('Unknown decision "%s". Use %s.'
                          % (decision, ' | '.join(sorted(DECISIONS))))

    # The label a correction carries, defaulting to the one the verdict already
    # has. A failed verdict has no label, so a correction there must name one.
    label = _string(payload, 'label') or classification.label
    if label is not None and label not in LABELS:
        raise ReviewError('Unknown label "%s". Use %s | %s.'
                          % (label, ClassificationReview.CLAUSE, ClassificationReview.NON_CLAUSE))

    note = _string(payload, 'note') or ''
    if decision == ClassificationReview.REJECTED and not note:
        raise ReviewError('A rejected verdict needs a note saying what is wrong with it.')

    type_key = _string(payload, 'type')
    sub_type = _string(payload, 'sub_type')

    if decision != ClassificationReview.CORRECTED:
        if type_key is not None:
            raise ReviewError('Only a corrected verdict carries a type; this one is "%s".'
                              % decision)
        return {'decision': decision, 'label': None, 'canonical_type': None,
                'sub_type': None, 'note': note}

    if type_key is None:
        raise ReviewError('A corrected verdict needs the type it should have had.')
    if label is None:
        raise ReviewError('A corrected verdict needs a label, because the original '
                          'classification failed and has none.')
    canonical_type = _resolve_type(type_key, label, classification.run.taxonomy_version)
    if label == ClassificationReview.NON_CLAUSE and sub_type:
        raise ReviewError('A Non-clause has no sub-type.')
    return {'decision': decision, 'label': label, 'canonical_type': canonical_type,
            'sub_type': sub_type if label == ClassificationReview.CLAUSE else None,
            'note': note}


@transaction.atomic
def record_decision(classification, payload, reviewed_by=(None, None)):
    """Store one decision and return it, superseding the previous one.

    The old row is kept with is_current cleared rather than updated in place,
    so "accepted, then corrected an hour later" stays legible afterwards.
    """
    fields = validate(classification, payload)
    email, name = reviewed_by
    previous = (ClassificationReview.objects.filter(classification=classification)
                .aggregate(highest=Max('revision'))['highest'] or 0)
    (ClassificationReview.objects
     .filter(classification=classification, is_current=True)
     .update(is_current=False))
    return ClassificationReview.objects.create(
        classification=classification,
        run=classification.run,
        document_id=classification.document_id,
        revision=previous + 1,
        reviewed_by_email=email,
        reviewed_by_name=name,
        **fields)


@transaction.atomic
def record_decisions(document, decisions, reviewed_by=(None, None)):
    """Several decisions for one document, all or nothing. -> [review]

    Validated as a batch before anything is written, so a bulk "accept
    everything visible" either lands whole or leaves the queue exactly as it
    was. The reviewer never has to work out which half of a click took effect.
    """
    from document_pipeline.services.export_service import current_classification_run

    if not isinstance(decisions, list) or not decisions:
        raise ReviewError('decisions must be a non-empty list.')

    run = current_classification_run(document)
    if run is None:
        raise ReviewError('This document has no current classification to review.')

    wanted = []
    for index, entry in enumerate(decisions):
        if not isinstance(entry, dict):
            raise ReviewError('decisions[%d] must be an object.' % index)
        classification_id = entry.get('classification_id')
        if not classification_id:
            raise ReviewError('decisions[%d] is missing classification_id.' % index)
        wanted.append((str(classification_id), entry))

    ids = [cid for cid, _ in wanted]
    if len(set(ids)) != len(ids):
        raise ReviewError('The same classification appears twice in one request.')

    try:
        rows = {str(c.id): c for c in Classification.objects.filter(run=run, id__in=ids)}
    except (ValueError, TypeError):
        raise ReviewError('classification_id must be a UUID.')

    missing = [cid for cid in ids if cid not in rows]
    if missing:
        raise ReviewError('Not part of the current classification run for this document: %s.'
                          % ', '.join(missing[:5]))

    # The whole batch is checked before a row is written.
    checked = [(rows[cid], validate(rows[cid], entry)) for cid, entry in wanted]

    # The revision each row is about to get, in one query for the whole batch.
    highest = {row['classification_id']: row['highest'] for row in
               (ClassificationReview.objects.filter(classification_id__in=ids)
                .values('classification_id').annotate(highest=Max('revision')))}

    email, name = reviewed_by
    (ClassificationReview.objects
     .filter(classification_id__in=ids, is_current=True)
     .update(is_current=False))
    return ClassificationReview.objects.bulk_create([
        ClassificationReview(classification=classification, run=run,
                             document_id=classification.document_id,
                             revision=highest.get(classification.id, 0) + 1,
                             reviewed_by_email=email, reviewed_by_name=name, **fields)
        for classification, fields in checked
    ])


def review_json(review):
    """One decision as the API returns it.

    None stays None: an item nobody has decided on sends `review: null`, the
    same not-yet shape the stage summaries use.
    """
    if review is None:
        return None
    return {
        'review_id': str(review.id),
        'revision': review.revision,
        'decision': review.decision,
        'label': review.label,
        'type': review.canonical_type.key if review.canonical_type else None,
        'type_name': review.canonical_type.name if review.canonical_type else None,
        'sub_type': review.sub_type,
        'note': review.note or None,
        'reviewed_by': review.reviewed_by_email,
        'reviewed_by_name': review.reviewed_by_name,
        'reviewed_at': review.created_at.isoformat() if review.created_at else None,
    }


def current_reviews_for_run(run):
    """-> {classification_id: review} for every decided item in the run."""
    if run is None:
        return {}
    rows = (ClassificationReview.objects
            .filter(run=run, is_current=True)
            .select_related('canonical_type'))
    return {r.classification_id: r for r in rows}


def review_counts_by_run(run_ids):
    """-> {run_id: {decision: count}} for a page of documents, in one query.

    The list endpoint shows review progress per row; without this it would be
    a query per row.
    """
    counts = {}
    rows = (ClassificationReview.objects
            .filter(run_id__in=run_ids, is_current=True)
            .values('run_id', 'decision')
            .annotate(total=Count('id')))
    for row in rows:
        counts.setdefault(row['run_id'], {})[row['decision']] = row['total']
    return counts


# ------------------------------------------------------------------ save

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


def final_verdict(classification, review):
    """-> {label, type, type_name, sub_type, decision}: what the item is once the
    reviewer's decision is applied. What the screen shows and what goes to the
    vector DB.

    The model's answer while nobody has decided, or when the decision was to
    accept it; the reviewer's when they corrected it; nothing when they
    rejected it without a replacement.
    """
    decision = review.decision if review is not None else None
    if decision == ClassificationReview.CORRECTED:
        label, canonical_type, sub_type = review.label, review.canonical_type, review.sub_type
    elif decision == ClassificationReview.REJECTED:
        label, canonical_type, sub_type = None, None, None
    else:
        label = classification.label
        canonical_type = classification.canonical_type
        sub_type = classification.sub_type
    return {
        'label': label,
        'type': canonical_type.key if canonical_type else None,
        'type_name': canonical_type.name if canonical_type else None,
        'sub_type': sub_type,
        'decision': decision,
    }


def _decision_for(classification, current, entry):
    """One Save entry -> the payload `validate` takes.

    The client sends the values the row shows now; which of accepted or
    corrected that is gets worked out here by comparing them with the model's
    answer, so no client has to know the rule. A field it leaves out keeps the
    value the row already has.
    """
    if _blank(entry.get('decision')) == ClassificationReview.REJECTED:
        return {'decision': ClassificationReview.REJECTED, 'note': entry.get('note')}

    shown = final_verdict(classification, current)
    if shown['decision'] == ClassificationReview.REJECTED:
        # Nothing to fall back on once rejected: start from the model's answer.
        shown = final_verdict(classification, None)
    label = _blank(entry['label']) if 'label' in entry else shown['label']
    type_key = _blank(entry['type']) if 'type' in entry else shown['type']
    sub_type = _blank(entry['sub_type']) if 'sub_type' in entry else _blank(shown['sub_type'])
    if label == ClassificationReview.NON_CLAUSE:
        sub_type = None

    model = (classification.label,
             classification.canonical_type.key if classification.canonical_type else None,
             _blank(classification.sub_type))
    note = entry.get('note')
    if (label, type_key, sub_type) == model:
        return {'decision': ClassificationReview.ACCEPTED, 'note': note}
    return {'decision': ClassificationReview.CORRECTED, 'label': label, 'type': type_key,
            'sub_type': sub_type, 'note': note}


def _same_as(review, fields):
    """True when a fresh decision would store exactly what `review` holds."""
    return (review is not None
            and review.decision == fields['decision']
            and review.label == fields['label']
            and review.canonical_type_id == (fields['canonical_type'].id
                                             if fields['canonical_type'] else None)
            and review.sub_type == fields['sub_type']
            and (review.note or '') == fields['note'])


def _next_review_status(current, all_reviewed):
    reopened = current in ('published', 'reopened_in_review', 'reopened_reviewed')
    if all_reviewed:
        return 'reopened_reviewed' if reopened else 'reviewed'
    return 'reopened_in_review' if reopened else 'in_review'


def _mirror(document, classification, verdict, user, now):
    """Copy one saved verdict onto the document's paragraph record, the table
    Update Vector DB reads. Created when finalize never materialised it, so a
    Save never depends on which path classified the document."""
    from document_pipeline.models import DocumentParagraphRecord

    chunk = classification.chunk
    record, _ = DocumentParagraphRecord.objects.get_or_create(
        document_id=document.id, paragraph_id=chunk.local_id,
        defaults={
            'chunk': chunk, 'classification': classification,
            'breadcrumb': chunk.breadcrumb.split(' > ') if chunk.breadcrumb else [],
            'sequence_order': chunk.order_index,
            'original_text': chunk.text, 'reviewed_text': chunk.text,
            'confidence': classification.confidence,
            'llm_issues': classification.review_reasons or [],
        })
    label = verdict['label'] or classification.label or DocumentParagraphRecord.CLAUSE
    canonical_type = verdict['type'] or ''
    sub_type = verdict['sub_type'] or ''
    changed = ((record.label, record.canonical_type, record.sub_type)
               != (label, canonical_type, sub_type))
    record.chunk = chunk
    record.classification = classification
    record.label, record.canonical_type, record.sub_type = label, canonical_type, sub_type
    record.is_reviewed = True
    record.reviewed_by = user
    # Pending for the vector DB when its values moved, or when it has never
    # been synced at all. A verdict accepted unchanged after a sync is not.
    record.is_modified = record.is_modified or changed or record.last_synced_at is None
    if changed:
        record.last_edited_by = user
        record.last_edited_at = now
    record.save()


def _is_uuid(value):
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


@transaction.atomic
def save_document(document, classification_run_id, items, user):
    """The Save button: store what the reviewer did to one document.

    Only the items sent are touched. Every entry is checked before anything is
    written, so a Save lands whole or not at all. An entry identical to its
    current decision is counted as unchanged and writes nothing, so pressing
    Save twice leaves no trace. Nothing is sent to the vector DB: saved items
    are marked pending, and Update Vector DB picks them up.

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
                                   .select_related('chunk', 'canonical_type', 'run'))}
    reviews = current_reviews_for_run(run)

    changed, counts = [], {'accepted': 0, 'corrected': 0, 'rejected': 0, 'unchanged': 0}
    for cid, entry in wanted:
        classification = rows.get(cid)
        if classification is None:
            errors.append({'classification_id': cid,
                           'detail': "Not part of this document's current classification."})
            continue
        current = reviews.get(classification.id)
        try:
            payload = _decision_for(classification, current, entry)
            fields = validate(classification, payload)
        except ReviewError as problem:
            errors.append({'classification_id': cid, 'detail': str(problem)})
            continue
        if _same_as(current, fields):
            counts['unchanged'] += 1
        else:
            counts[fields['decision']] += 1
            changed.append(dict(payload, classification_id=cid))

    if errors:
        raise SaveError('%d item(s) could not be saved, so nothing was saved.' % len(errors),
                        errors=errors)

    if changed:
        record_decisions(document, changed, (user.email, user.username))

    now = timezone.now()
    reviews = current_reviews_for_run(run)
    for cid in ids:
        classification = rows[cid]
        _mirror(document, classification,
                final_verdict(classification, reviews.get(classification.id)), user, now)

    total = Classification.objects.filter(run=run).count()
    document.refresh_from_db(fields=['review_status'])
    status = _next_review_status(document.review_status, len(reviews) >= total)
    if status != document.review_status:
        Document.objects.filter(pk=document.pk).update(review_status=status)

    written = counts['accepted'] + counts['corrected'] + counts['rejected']
    if written:
        parts = ['%d %s' % (counts[k], k) for k in ('accepted', 'corrected', 'rejected')
                 if counts[k]]
        log_activity(
            document_id=document.id,
            phase=DocumentActivityLog.USER_INTERACTION,
            action=DocumentActivityLog.ACT_SAVED,
            summary='%s saved %d item(s): %s.' % (user.username, written, ', '.join(parts)),
            actor_user=user,
            metadata=dict(counts, classification_run_id=str(run.id),
                          classification_ids=[c['classification_id'] for c in changed],
                          reviewed=len(reviews), total=total),
        )

    return {'saved': counts, 'classification_ids': ids, 'review_status': status}


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
