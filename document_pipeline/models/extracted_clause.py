"""One clause of one extraction run."""
import uuid

from django.db import models
from django.db.models import Q


class ExtractedClause(models.Model):
    """A clause as the parser emitted it.

    Field names match the parser's clause dict except for two renames:
    `clause_id` -> `local_id` (it is document-local, not globally unique) and
    `parent_id` -> a real self-FK `parent`.

    List-valued keys stay JSON. Anything the review UI filters on is a real
    column instead, because JSONField containment lookups raise on SQLite and
    the test suite runs on the SQLite fallback.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey('document_pipeline.ExtractionRun', on_delete=models.CASCADE,
                            related_name='clauses')
    local_id = models.CharField(max_length=32)
    parent = models.ForeignKey('self', on_delete=models.CASCADE,
                               null=True, blank=True, related_name='children')

    level = models.PositiveIntegerField()
    assigned_depth = models.IntegerField()
    display_number = models.CharField(max_length=64, null=True, blank=True)
    clause_title = models.TextField(null=True, blank=True)
    canonical_path = models.TextField(null=True, blank=True)
    full_path = models.TextField(null=True, blank=True)
    parent_path = models.TextField(null=True, blank=True)

    is_compound_lead_in = models.BooleanField(default=False)
    bonded_to_lead_in = models.CharField(max_length=32, null=True, blank=True)
    child_count = models.PositiveIntegerField(default=0)
    descendant_count = models.PositiveIntegerField(default=0)
    sibling_index = models.PositiveIntegerField(default=1)
    sibling_count = models.PositiveIntegerField(default=1)
    is_leaf = models.BooleanField(default=True)

    # order_index is document order and the paging key. dfs_index plus
    # descendant_count give a subtree as a range scan, with no recursive CTE:
    # descendants are dfs_index in (n.dfs_index, n.dfs_index + n.descendant_count].
    order_index = models.PositiveIntegerField()
    dfs_index = models.PositiveIntegerField()
    bfs_index = models.PositiveIntegerField()

    text = models.TextField(blank=True, default='')
    body_text = models.TextField(blank=True, default='')
    numbering_source = models.CharField(max_length=64, null=True, blank=True)
    style = models.CharField(max_length=128, null=True, blank=True)

    confidence = models.FloatField(null=True, blank=True)
    conflict = models.BooleanField(default=False)
    # Derived from flags at write time so "show me flagged clauses" is an
    # indexable boolean rather than a JSON containment lookup.
    has_flags = models.BooleanField(default=False)

    lead_in_child_ids = models.JSONField(default=list, blank=True)
    ancestor_ids = models.JSONField(default=list, blank=True)
    child_ids = models.JSONField(default=list, blank=True)
    # Kept for fidelity. NOT the clause/paragraph edge -- it omits table cells.
    paragraph_ids = models.JSONField(default=list, blank=True)
    flags = models.JSONField(default=list, blank=True)
    # Catches keys a future schema_version adds, so nothing is silently lost.
    extra = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'extracted_clauses'
        constraints = [
            models.UniqueConstraint(fields=['run', 'local_id'], name='unique_clause_local_id'),
            models.UniqueConstraint(fields=['run', 'order_index'], name='unique_clause_order'),
        ]
        indexes = [
            models.Index(fields=['run', 'order_index'], name='clause_run_order_idx'),
            models.Index(fields=['run', 'dfs_index'], name='clause_run_dfs_idx'),
            models.Index(fields=['run', 'level'], name='clause_run_level_idx'),
            models.Index(fields=['run', 'confidence'], name='clause_run_conf_idx'),
            models.Index(fields=['run', 'order_index'], condition=Q(has_flags=True),
                         name='clause_run_flagged_idx'),
            models.Index(fields=['run', 'order_index'], condition=Q(conflict=True),
                         name='clause_run_conflict_idx'),
        ]
        ordering = ['order_index']

    def __str__(self):
        return '%s %s' % (self.local_id, self.display_number or self.clause_title or '')
