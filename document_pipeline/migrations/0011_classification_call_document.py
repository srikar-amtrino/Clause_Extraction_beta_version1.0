"""Give classification calls the document_id their model declares.

0013 on the other branch adds the same column, and a database that ran it (or
got the column outside this history) already has it. So the column is added
only where it is missing; a database that already has it is left as it is.
"""

from django.db import migrations, models
import django.db.models.deletion


def field():
    return models.ForeignKey(
        on_delete=django.db.models.deletion.CASCADE,
        related_name='classification_calls',
        to='document_pipeline.document',
    )


def _has_column(schema_editor, model, field):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, model._meta.db_table)
    return field.column in {column.name for column in columns}


def add_missing_column(apps, schema_editor):
    model = apps.get_model('document_pipeline', 'ClassificationCall')
    document = model._meta.get_field('document')
    if not _has_column(schema_editor, model, document):
        schema_editor.add_field(model, document)


def drop_column(apps, schema_editor):
    model = apps.get_model('document_pipeline', 'ClassificationCall')
    document = model._meta.get_field('document')
    if _has_column(schema_editor, model, document):
        schema_editor.remove_field(model, document)


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0010_merge_0007_review_workspace_0009_classificationreview'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(state_operations=[
            migrations.AddField(
                model_name='classificationcall',
                name='document',
                field=field(),
            ),
        ]),
        migrations.RunPython(add_missing_column, drop_column),
    ]
