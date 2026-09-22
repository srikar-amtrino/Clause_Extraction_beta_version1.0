"""A reviewer's decision about one classification."""
import uuid

from django.db import models
from django.db.models import Q


class ClassificationReview(models.Model):
    """What a person decided about one Classification row.

    A table of its own on purpose. A classification run is an audit record --
    ClassificationRun says a run stays readable so a review already made
    against it is never rewritten -- so a decision never edits the verdict it
    is about. Deciding again writes a new row and clears `is_current` on the
    old one, which keeps the trail of who changed their mind and when.

    Three decisions, and what each one stores:

    - accepted   the verdict stands. No type: the classification already holds
                 it, and copying it here would let the two drift apart.
    - corrected  the reviewer names a different type. `canonical_type` is
                 required and is what an export reads instead of the model's.
    - rejected   the verdict is wrong and no replacement is offered. `note` is
                 required, so a rejection always says why.

    The label/sub-type invariants match Classification's own, as check
    constraints rather than only Python: a corrected verdict cannot be stored
    in a shape the classifier itself could never have produced.
    """

    ACCEPTED = 'accepted'
    CORRECTED = 'corrected'
    REJECTED = 'rejected'
    DECISION_CHOICES = [(ACCEPTED, ACCEPTED), (CORRECTED, CORRECTED), (REJECTED, REJECTED)]

    CLAUSE = 'Clause'
    NON_CLAUSE = 'Non-clause'
    LABEL_CHOICES = [(CLAUSE, CLAUSE), (NON_CLAUSE, NON_CLAUSE)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    classification = models.ForeignKey('document_pipeline.Classification',
                                       on_delete=models.CASCADE, related_name='reviews')
    # Denormalised from classification.run so the review queue can count a
    # document's progress without joining through every classification row.
    run = models.ForeignKey('document_pipeline.ClassificationRun', on_delete=models.CASCADE,
                            related_name='reviews')

    decision = models.CharField(max_length=16, choices=DECISION_CHOICES)
    label = models.CharField(max_length=16, choices=LABEL_CHOICES, null=True, blank=True)
    # PROTECT for the same reason Classification uses it: a type a decision
    # points at can never be deleted from under it.
    canonical_type = models.ForeignKey('document_pipeline.CanonicalType',
                                       on_delete=models.PROTECT, null=True, blank=True,
                                       related_name='reviews')
    sub_type = models.CharField(max_length=255, null=True, blank=True)
    note = models.TextField(blank=True, default='')

    # Taken from the Drive session, never from the request body: a reviewer
    # name the client could choose is worth nothing in an audit trail. Null
    # when nobody was signed in, which is honest about what we know.
    reviewed_by_email = models.EmailField(null=True, blank=True)
    reviewed_by_name = models.CharField(max_length=255, null=True, blank=True)

    is_current = models.BooleanField(default=True)
    # 1 for the first decision on a classification, 2 for the one that
    # replaced it, and so on. History is ordered by this rather than by
    # created_at, which ties when two decisions land in the same microsecond --
    # exactly what a bulk accept does.
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'classification_reviews'
        constraints = [
            # One live decision per classification; superseded rows stay.
            models.UniqueConstraint(fields=['classification'], condition=Q(is_current=True),
                                    name='unique_current_review_per_classification'),
            models.CheckConstraint(
                condition=(Q(decision='corrected', canonical_type__isnull=False)
                           | (~Q(decision='corrected') & Q(canonical_type__isnull=True))),
                name='review_type_iff_corrected'),
            models.CheckConstraint(
                condition=~Q(decision='rejected') | ~Q(note=''),
                name='review_rejected_has_note'),
            models.CheckConstraint(
                condition=~Q(label='Non-clause') | Q(sub_type__isnull=True),
                name='review_non_clause_has_no_sub_type'),
            models.UniqueConstraint(fields=['classification', 'revision'],
                                    name='unique_review_revision'),
        ]
        indexes = [
            # The queue's two reads: one document's progress, one item's history.
            models.Index(fields=['run'], condition=Q(is_current=True), name='review_run_current_idx'),
            models.Index(fields=['classification', '-revision'], name='review_history_idx'),
        ]

    def __str__(self):
        return '%s %s v%d' % (self.classification_id, self.decision, self.revision)
