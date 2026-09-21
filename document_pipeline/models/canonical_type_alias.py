"""One "Also appears as" entry of a canonical type."""
import uuid

from django.db import models
from django.db.models import Q


class CanonicalTypeAlias(models.Model):
    """A heading a contract may use for a canonical type.

    `alias` is the taxonomy's text verbatim; `match_key` is the normalised
    surface form lookups compare against. Most aliases are literal headings. A
    few carry a sense restriction in parentheses -- "Applicable Law (obligation
    sense)" -- that no contract contains. Those are stored with
    is_literal=False: they render into the prompt as guidance and are never a
    lookup key, because their surface form ("applicable law") belongs to
    another type as a literal alias.

    `version` repeats the type's version so the partial unique index below can
    span every type in a taxonomy: one literal surface form, one type.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    canonical_type = models.ForeignKey('document_pipeline.CanonicalType',
                                       on_delete=models.CASCADE, related_name='aliases')
    version = models.CharField(max_length=16)
    alias = models.CharField(max_length=255)
    match_key = models.CharField(max_length=255)
    is_literal = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True, default='')
    # The taxonomy's own order, so the prompt renders byte-identically every time.
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'canonical_type_aliases'
        constraints = [
            # A collision fails the seeding migration instead of silently
            # mapping one heading to whichever type happened to load last.
            models.UniqueConstraint(fields=['version', 'match_key'], condition=Q(is_literal=True),
                                    name='unique_literal_alias_match_key'),
            models.UniqueConstraint(fields=['canonical_type', 'alias'],
                                    name='unique_alias_per_type'),
        ]
        indexes = [
            models.Index(fields=['version', 'match_key'], name='ctalias_version_key_idx'),
        ]
        ordering = ['canonical_type', 'position']

    def __str__(self):
        return self.alias
