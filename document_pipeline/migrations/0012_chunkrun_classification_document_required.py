"""Make chunk_runs.document_id and classifications.document_id required.

0011 added and backfilled them. On a database that already had them required,
this only re-asserts what is there.
"""
import django.db.models.deletion
from django.db import migrations, models


def field(related_name):
    return models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                             related_name=related_name, to='document_pipeline.document')


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0011_chunkrun_classification_document'),
    ]

    operations = [
        migrations.AlterField('chunkrun', 'document', field('chunk_runs')),
        migrations.AlterField('classification', 'document', field('classifications')),
    ]
