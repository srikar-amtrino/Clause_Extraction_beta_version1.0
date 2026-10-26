"""Give classification calls and reviews the document_id their tables may hold.

The same gap 0011 closed for chunk runs and classifications: some databases
have a required document_id on classification_calls and classification_reviews,
added outside this history with Django's own constraint and index names, while
the models did not declare it -- so every insert there failed. The column is
added only where it is missing, then backfilled from the classification run.

0014 makes it required, in its own migration for the reason 0012 gives.
"""
import django.db.models.deletion
from django.db import migrations, models
from django.db.models import OuterRef, Subquery

MODELS = ('ClassificationCall', 'ClassificationReview')


def field(related_name):
    return models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE,
                             related_name=related_name, to='document_pipeline.document')


def _has_column(schema_editor, model, field):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, model._meta.db_table)
    return field.column in {column.name for column in columns}


def add_missing_columns(apps, schema_editor):
    ClassificationRun = apps.get_model('document_pipeline', 'ClassificationRun')
    run_document = ClassificationRun.objects.filter(pk=OuterRef('run_id')).values('document_id')[:1]
    for name in MODELS:
        model = apps.get_model('document_pipeline', name)
        document = model._meta.get_field('document')
        if not _has_column(schema_editor, model, document):
            schema_editor.add_field(model, document)
        model.objects.filter(document__isnull=True).update(document_id=Subquery(run_document))


def drop_columns(apps, schema_editor):
    for name in MODELS:
        model = apps.get_model('document_pipeline', name)
        document = model._meta.get_field('document')
        if _has_column(schema_editor, model, document):
            schema_editor.remove_field(model, document)


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0012_chunkrun_classification_document_required'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(state_operations=[
            migrations.AddField('classificationcall', 'document', field('classification_calls')),
            migrations.AddField('classificationreview', 'document',
                                field('classification_reviews')),
        ]),
        migrations.RunPython(add_missing_columns, drop_columns),
    ]
