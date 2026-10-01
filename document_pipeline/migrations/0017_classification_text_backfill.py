"""Every existing classification row gets its clause text from its chunk.

Its own migration, so the UPDATE runs in a transaction with no schema change
after it: Postgres refuses to alter or index a table holding rows updated
earlier in the same transaction.
"""
from django.db import migrations
from django.db.models import OuterRef, Subquery


def fill_text(apps, schema_editor):
    Classification = apps.get_model('document_pipeline', 'Classification')
    Chunk = apps.get_model('document_pipeline', 'Chunk')
    (Classification.objects.filter(text__isnull=True)
     .update(text=Subquery(Chunk.objects.filter(pk=OuterRef('chunk_id')).values('text')[:1])))


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0016_classification_review_in_place'),
    ]

    operations = [
        migrations.RunPython(fill_text, migrations.RunPython.noop),
    ]
