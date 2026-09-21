"""An explicit boundary between two canonical types."""
import uuid

from django.db import models
from django.db.models import F, Q


class CanonicalTypeExclusion(models.Model):
    """"Excludes early exit (-> 26)": content from_type's definition hands to to_type.

    Kept as rows rather than left in the definition text so the boundary is
    both rendered into the prompt and testable.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    from_type = models.ForeignKey('document_pipeline.CanonicalType', on_delete=models.CASCADE,
                                  related_name='exclusions')
    to_type = models.ForeignKey('document_pipeline.CanonicalType', on_delete=models.CASCADE,
                                related_name='excluded_from')
    note = models.CharField(max_length=255)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'canonical_type_exclusions'
        constraints = [
            models.UniqueConstraint(fields=['from_type', 'to_type'], name='unique_type_exclusion'),
            models.CheckConstraint(condition=~Q(from_type=F('to_type')),
                                   name='type_exclusion_not_self'),
        ]
        ordering = ['from_type', 'position']

    def __str__(self):
        return '%s excludes %s' % (self.from_type_id, self.to_type_id)
