"""Seed taxonomy v1: 35 clause types and 11 non-clause types.

Loads document_pipeline/classification/taxonomies/v1.json. That file must never
be edited once this migration has run anywhere: a new vocabulary is a new file,
a new version string, and a new migration.
"""
from django.db import migrations

from document_pipeline.classification.taxonomy import seed_taxonomy, unseed_taxonomy

VERSION = 'v1'


def forwards(apps, schema_editor):
    seed_taxonomy(apps, VERSION)


def backwards(apps, schema_editor):
    unseed_taxonomy(apps, VERSION)


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0003_classification'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
