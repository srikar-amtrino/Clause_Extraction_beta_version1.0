"""Carry the source paragraphs on the classification itself.

The ids were always reachable through the chunk; holding them on the row makes
a verdict self-contained, so a review queue or an export can go from a label
back to the text it was given without a join.

Rows written before this migration are backfilled from their chunk rather than
left at the default, because an empty list on an existing row would read as
"this verdict covers no text" -- indistinguishable from a real coverage gap.
"""
from django.db import migrations, models


BATCH = 1000


def backfill(apps, schema_editor):
    Classification = apps.get_model('document_pipeline', 'Classification')
    Chunk = apps.get_model('document_pipeline', 'Chunk')

    # In batches: a corpus has one row per micro chunk per run, which grows
    # with every re-classification, so the whole table does not belong in
    # memory at once.
    batch = []
    for row in Classification.objects.only('id', 'chunk_id').iterator(chunk_size=BATCH):
        batch.append(row)
        if len(batch) >= BATCH:
            _write(Classification, Chunk, batch)
            batch = []
    _write(Classification, Chunk, batch)


def _write(Classification, Chunk, rows):
    if not rows:
        return
    ids = dict(Chunk.objects.filter(id__in=[r.chunk_id for r in rows])
               .values_list('id', 'paragraph_ids'))
    for row in rows:
        row.paragraph_ids = ids.get(row.chunk_id) or []
    Classification.objects.bulk_update(rows, ['paragraph_ids'], batch_size=500)


def noop(apps, schema_editor):
    """The column goes away on reverse, so there is nothing to undo."""


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0006_document_on_clause_paragraph_chunk'),
    ]

    operations = [
        migrations.AddField(
            model_name='classification',
            name='paragraph_ids',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(backfill, noop),
    ]
