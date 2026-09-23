from django.db import migrations


SQL = """
CREATE OR REPLACE FUNCTION fill_classification_document_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.document_id IS NULL THEN
        SELECT classification_run.document_id
        INTO NEW.document_id
        FROM classification_runs AS classification_run
        WHERE classification_run.id = NEW.run_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS classifications_fill_document_id ON classifications;
CREATE TRIGGER classifications_fill_document_id
BEFORE INSERT ON classifications
FOR EACH ROW
EXECUTE FUNCTION fill_classification_document_id();

DROP TRIGGER IF EXISTS classification_calls_fill_document_id ON classification_calls;
CREATE TRIGGER classification_calls_fill_document_id
BEFORE INSERT ON classification_calls
FOR EACH ROW
EXECUTE FUNCTION fill_classification_document_id();

DROP TRIGGER IF EXISTS classification_reviews_fill_document_id ON classification_reviews;
CREATE TRIGGER classification_reviews_fill_document_id
BEFORE INSERT ON classification_reviews
FOR EACH ROW
EXECUTE FUNCTION fill_classification_document_id();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS classifications_fill_document_id ON classifications;
DROP TRIGGER IF EXISTS classification_calls_fill_document_id ON classification_calls;
DROP TRIGGER IF EXISTS classification_reviews_fill_document_id ON classification_reviews;
DROP FUNCTION IF EXISTS fill_classification_document_id();
"""


def install_triggers(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(SQL)


def remove_triggers(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(REVERSE_SQL)


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0012_fill_chunk_run_document_id'),
    ]

    operations = [
        migrations.RunPython(install_triggers, remove_triggers),
    ]
