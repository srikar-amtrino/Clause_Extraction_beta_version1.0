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
    chunk = models.ForeignKey('document_pipeline.Chunk', on_delete=models.CASCADE,
                              related_name='classifications')

    outcome = models.CharField(max_length=16, choices=OUTCOME_CHOICES)
    label = models.CharField(max_length=16, choices=LABEL_CHOICES, null=True, blank=True)
    # PROTECT: a type a verdict points at can never be deleted from under it.
    canonical_type = models.ForeignKey('document_pipeline.CanonicalType',
                                       on_delete=models.PROTECT, null=True, blank=True,
                                       related_name='classifications')
    sub_type = models.CharField(max_length=255, null=True, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    reason = models.TextField(blank=True, default='')

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
            models.CheckConstraint(
                condition=Q(outcome='failed') | ~Q(reason=''),
                name='classification_has_reason'),
        ]
        indexes = [
            models.Index(fields=['chunk'], name='class_chunk_idx'),
            models.Index(fields=['run', 'canonical_type'], name='class_run_type_idx'),
            # The review queue reads exactly this slice.
            models.Index(fields=['run'], condition=Q(needs_review=True),
                         name='class_run_review_idx'),
        ]

    def __str__(self):
        return '%s %s' % (self.chunk_id, self.outcome)
