"""The label given to one micro chunk in one classification run."""
import uuid

from django.db import models
from django.db.models import Q


class Classification(models.Model):
    """One micro chunk's classification. Exactly one row per micro per run.

    Every micro gets a row whatever happened to it, so the run's coverage is
    provable and nothing drops out of the audit trail silently:

    - classified: a label and a canonical type.
    - unclassified: a Clause that fits none of the clause types. Recorded as a
      visible state instead of being forced into the nearest type, where a
      misfit would hide.
    - failed: the model never produced a valid answer. The row carries the
      error and goes to review.

    The model is still made to justify each answer -- an empty justification
    fails validation and the item is retried -- but the prose is not kept: the
    review queue works from the type, the confidence and the review reasons.

    The invariants between those states are check constraints, not only Python,
    so no code path -- including a hand-written fix-up -- can store a Non-clause
    with a sub-type or a classified row without a type.
    """

    CLASSIFIED = 'classified'
    UNCLASSIFIED = 'unclassified'
    FAILED = 'failed'
    OUTCOME_CHOICES = [(CLASSIFIED, CLASSIFIED), (UNCLASSIFIED, UNCLASSIFIED), (FAILED, FAILED)]

    CLAUSE = 'Clause'
    NON_CLAUSE = 'Non-clause'
    LABEL_CHOICES = [(CLAUSE, CLAUSE), (NON_CLAUSE, NON_CLAUSE)]

    # Why a row is in the review queue. Several can apply at once.
    LOW_CONFIDENCE = 'low_confidence'
    HIGH_RISK = 'high_risk'
    DEVIATED = 'deviated'
    REVIEW_UNCLASSIFIED = 'unclassified'
    REVIEW_FAILED = 'failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey('document_pipeline.ClassificationRun', on_delete=models.CASCADE,
                            related_name='classifications')
    document = models.ForeignKey('document_pipeline.Document', on_delete=models.CASCADE,
                                 related_name='classifications')
    chunk = models.ForeignKey('document_pipeline.Chunk', on_delete=models.CASCADE,
                              related_name='classifications')
    # The source paragraphs this verdict covers, copied from the chunk so a
    # row carries its own audit trail: a reviewer or an export can go from a
    # label straight back to the text it was given without joining through
    # chunks. Plural because a micro chunk is one clause, and a clause is
    # regularly several paragraphs -- about a fifth of them are.
    paragraph_ids = models.JSONField(default=list, blank=True)

    outcome = models.CharField(max_length=16, choices=OUTCOME_CHOICES)
    label = models.CharField(max_length=16, choices=LABEL_CHOICES, null=True, blank=True)
    # PROTECT: a type a verdict points at can never be deleted from under it.
    canonical_type = models.ForeignKey('document_pipeline.CanonicalType',
                                       on_delete=models.PROTECT, null=True, blank=True,
                                       related_name='classifications')
    sub_type = models.CharField(max_length=255, null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)

    # The types the section's heading trail implies, and whether the answer
    # fell outside them. Computed here, not reported by the model, so the check
    # does not depend on the model noticing its own deviation.
    expected_type_keys = models.JSONField(default=list, blank=True)
    deviated = models.BooleanField(default=False)

    needs_review = models.BooleanField(default=False)
    review_reasons = models.JSONField(default=list, blank=True)

    batch_index = models.PositiveIntegerField(default=0)
    call_attempts = models.PositiveIntegerField(default=1)
    # The model's item verbatim, and what post-processing changed about it.
    raw_item = models.JSONField(null=True, blank=True)
    validation_notes = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    # ---- The reviewer's pass, updated in place by Save ---------------------
    # label / canonical_type / sub_type above stay the model's answer. What a
    # reviewer saves goes here, on the same row: saving again overwrites these
    # columns, it never adds a row. Who changed what, from what, is in the
    # document's activity log.
    ACCEPTED = 'accepted'
    CORRECTED = 'corrected'
    REJECTED = 'rejected'
    DECISION_CHOICES = [(ACCEPTED, ACCEPTED), (CORRECTED, CORRECTED), (REJECTED, REJECTED)]

    # The clause text as it stands: the source text, until a reviewer edits it.
    # chunk.text keeps the source text either way.
    text = models.TextField(null=True, blank=True)
    # Null until someone saves the item.
    review_decision = models.CharField(max_length=16, choices=DECISION_CHOICES,
                                       null=True, blank=True)
    # The verdict the item carries after review: the model's own when accepted,
    # the reviewer's when corrected, empty when rejected.
    reviewed_label = models.CharField(max_length=16, choices=LABEL_CHOICES,
                                      null=True, blank=True)
    reviewed_canonical_type = models.ForeignKey('document_pipeline.CanonicalType',
                                                on_delete=models.PROTECT, null=True, blank=True,
                                                related_name='reviewed_classifications')
    reviewed_sub_type = models.CharField(max_length=255, null=True, blank=True)
    review_note = models.TextField(blank=True, default='')
    reviewed_by = models.ForeignKey('core.User', on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='reviewed_classifications')
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'classifications'
        constraints = [
            models.UniqueConstraint(fields=['run', 'chunk'], name='unique_classification_chunk'),
            models.CheckConstraint(
                condition=(Q(outcome='classified', canonical_type__isnull=False)
                           | (~Q(outcome='classified') & Q(canonical_type__isnull=True))),
                name='classification_type_iff_classified'),
            models.CheckConstraint(
                condition=~Q(outcome='unclassified') | Q(label='Clause'),
                name='unclassified_is_clause'),
            models.CheckConstraint(
                condition=(Q(outcome='failed', label__isnull=True, confidence__isnull=True)
                           | (~Q(outcome='failed')
                              & Q(label__isnull=False, confidence__isnull=False))),
                name='classification_failed_has_no_answer'),
            models.CheckConstraint(
                condition=~Q(label='Non-clause') | Q(sub_type__isnull=True),
                name='non_clause_has_no_sub_type'),
            models.CheckConstraint(
                condition=Q(confidence__isnull=True) | Q(confidence__gte=0.0, confidence__lte=1.0),
                name='classification_confidence_range'),
            # The reviewer's verdict obeys the same shape rules as the model's.
            models.CheckConstraint(
                condition=~Q(review_decision='corrected') | Q(reviewed_canonical_type__isnull=False),
                name='corrected_has_reviewed_type'),
            models.CheckConstraint(
                condition=~Q(review_decision='rejected') | ~Q(review_note=''),
                name='rejected_has_review_note'),
            models.CheckConstraint(
                condition=~Q(reviewed_label='Non-clause') | Q(reviewed_sub_type__isnull=True),
                name='reviewed_non_clause_has_no_sub_type'),
        ]
        indexes = [
            models.Index(fields=['chunk'], name='class_chunk_idx'),
            models.Index(fields=['run', 'canonical_type'], name='class_run_type_idx'),
            # The review queue reads exactly this slice.
            models.Index(fields=['run'], condition=Q(needs_review=True),
                         name='class_run_review_idx'),
            # Review progress per run: how many items have been saved.
            models.Index(fields=['run', 'review_decision'], name='class_run_decision_idx'),
        ]

    def __str__(self):
        return '%s %s' % (self.chunk_id, self.outcome)
