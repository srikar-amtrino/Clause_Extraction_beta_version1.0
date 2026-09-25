"""Give chunk runs and classifications the document_id their models declare.

Both models gained a `document` foreign key without a migration, so a database
built from this history had no such column and every insert failed. Some
databases got the column by other means, with the constraint and index names
Django itself generates. So the column is added only where it is missing, then
backfilled from the parent run; a database that already has it is left as it is.

0012 makes the column required. It is a separate migration because Postgres
will not alter a table in the same transaction as an update that still has
deferred foreign-key checks pending.
"""
import django.db.models.deletion
from django.db import migrations, models
from django.db.models import OuterRef, Subquery

MODELS = ('ChunkRun', 'Classification')


def field(related_name):
    return models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE,
                             related_name=related_name, to='document_pipeline.document')


def _has_column(schema_editor, model, field):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, model._meta.db_table)
    return field.column in {column.name for column in columns}


def add_missing_columns(apps, schema_editor):
    for name in MODELS:
        model = apps.get_model('document_pipeline', name)
        document = model._meta.get_field('document')
        if not _has_column(schema_editor, model, document):
            schema_editor.add_field(model, document)

    ExtractionRun = apps.get_model('document_pipeline', 'ExtractionRun')
    ClassificationRun = apps.get_model('document_pipeline', 'ClassificationRun')
    apps.get_model('document_pipeline', 'ChunkRun').objects.filter(document__isnull=True).update(
        document_id=Subquery(ExtractionRun.objects.filter(pk=OuterRef('extraction_run_id'))
                             .values('document_id')[:1]))
    apps.get_model('document_pipeline', 'Classification').objects.filter(document__isnull=True).update(
        document_id=Subquery(ClassificationRun.objects.filter(pk=OuterRef('run_id'))
                             .values('document_id')[:1]))


def drop_columns(apps, schema_editor):
    for name in MODELS:
        model = apps.get_model('document_pipeline', name)
        document = model._meta.get_field('document')
        if _has_column(schema_editor, model, document):
            schema_editor.remove_field(model, document)


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0010_merge_0007_review_workspace_0009_classificationreview'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(state_operations=[
            migrations.AddField('chunkrun', 'document', field('chunk_runs')),
            migrations.AddField('classification', 'document', field('classifications')),
        ]),
        migrations.RunPython(add_missing_columns, drop_columns),
    ]
