"""Recording what a reviewer decided about a classification.

One entry point, `record_decision`, used by both the single and the bulk
endpoint, so a decision made on its own and a decision made in a batch of forty
go through exactly the same validation.

Every rejected payload raises ReviewError carrying a sentence meant to be read
by the person who caused it. The view turns that into a 400 without knowing
anything about the rules.
"""
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
