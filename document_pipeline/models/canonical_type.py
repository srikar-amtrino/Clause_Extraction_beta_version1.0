"""One entry of a versioned classification taxonomy."""
import uuid

from django.db import models
from django.db.models import Q

from .agreement_type import AgreementType


class CanonicalType(models.Model):
    """A type a classification may assign.

    Taxonomies are versioned data, not code. A version is seeded once from
    `classification/taxonomies/<version>.json` by a data migration and never
    edited afterwards: a classification holds a foreign key to the type it was
    given, so rewriting the type under it would silently change what an old
    verdict says. A new vocabulary is a new version loaded alongside the old.

    `applies_to` splits a version in two. A Clause may only take a clause type
    and a Non-clause only a non-clause type; the output schema sent to the
    model enforces the same split.
    """

    CLAUSE = 'clause'
    NON_CLAUSE = 'non_clause'
    APPLIES_TO_CHOICES = [(CLAUSE, CLAUSE), (NON_CLAUSE, NON_CLAUSE)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    version = models.CharField(max_length=16)
    applies_to = models.CharField(max_length=16, choices=APPLIES_TO_CHOICES)
    # The taxonomy's own numbering, which restarts for non-clause types. The
    # definitions cross-reference it ("Excludes early exit (-> 26)").
    number = models.PositiveIntegerField()
    key = models.SlugField(max_length=64)
    name = models.CharField(max_length=128)
    definition = models.TextField()
    aliases = models.JSONField(blank=True, default=list)
    agreement_type = models.ForeignKey(
        AgreementType,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='canonical_types',
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'canonical_types'
        constraints = [
            models.UniqueConstraint(
                fields=['version', 'key'],
                condition=Q(agreement_type__isnull=True),
                name='unique_ctype_key_global',
            ),
            models.UniqueConstraint(
                fields=['version', 'agreement_type', 'key'],
                condition=Q(agreement_type__isnull=False),
                name='unique_ctype_key_agreement',
            ),
            models.UniqueConstraint(
                fields=['version', 'name'],
                condition=Q(agreement_type__isnull=True),
                name='unique_ctype_name_global',
            ),
            models.UniqueConstraint(
                fields=['version', 'agreement_type', 'name'],
                condition=Q(agreement_type__isnull=False),
                name='unique_ctype_name_agreement',
            ),
            models.UniqueConstraint(
                fields=['version', 'applies_to', 'number'],
                condition=Q(agreement_type__isnull=True),
                name='unique_ctype_number_global',
            ),
            models.UniqueConstraint(
                fields=['version', 'agreement_type', 'applies_to', 'number'],
                condition=Q(agreement_type__isnull=False),
                name='unique_ctype_number_agreement',
            ),
        ]
        indexes = [
            models.Index(fields=['version', 'sort_order'], name='ctype_version_order_idx'),
        ]
        ordering = ['version', 'sort_order']

    def __str__(self):
        return '%s %s' % (self.version, self.name)
