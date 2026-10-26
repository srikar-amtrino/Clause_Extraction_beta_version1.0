"""Add is_exhibit and exhibit_type columns to classifications and paragraph records.

Both columns are NULL by default — Claude Sonnet never sets them; only a
reviewer can mark a clause as an exhibit from the review workspace.

exhibit_type_normalized is a backend-cleaned copy of exhibit_type that is used
for grouping and Qdrant payload indexing.  It is computed automatically on save
and is never edited by the reviewer directly.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0024_agreement_type_prompt'),
    ]

    operations = [
        # --- Classification table -----------------------------------------
        migrations.AddField(
            model_name='classification',
            name='is_exhibit',
            field=models.BooleanField(null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name='classification',
            name='exhibit_type',
            field=models.CharField(max_length=255, null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name='classification',
            name='exhibit_type_normalized',
            field=models.CharField(max_length=255, null=True, blank=True, default=None),
        ),

        # --- DocumentParagraphRecord table -----------------------------------
        migrations.AddField(
            model_name='documentparagraphrecord',
            name='is_exhibit',
            field=models.BooleanField(null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name='documentparagraphrecord',
            name='exhibit_type',
            field=models.CharField(max_length=255, null=True, blank=True, default=None),
        ),
        migrations.AddField(
            model_name='documentparagraphrecord',
            name='exhibit_type_normalized',
            field=models.CharField(max_length=255, null=True, blank=True, default=None),
        ),
    ]
