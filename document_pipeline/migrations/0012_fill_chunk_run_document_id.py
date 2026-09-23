from django.db import migrations


SQL = """
CREATE OR REPLACE FUNCTION fill_chunk_run_document_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.document_id IS NULL THEN
        SELECT extraction_run.document_id
        INTO NEW.document_id
        FROM extraction_runs AS extraction_run
        WHERE extraction_run.id = NEW.extraction_run_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chunk_runs_fill_document_id ON chunk_runs;
CREATE TRIGGER chunk_runs_fill_document_id
BEFORE INSERT ON chunk_runs
FOR EACH ROW
EXECUTE FUNCTION fill_chunk_run_document_id();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS chunk_runs_fill_document_id ON chunk_runs;
DROP FUNCTION IF EXISTS fill_chunk_run_document_id();
"""


def install_trigger(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(SQL)


def remove_trigger(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(REVERSE_SQL)


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0011_chunkrun_document_classification_document_and_more'),
    ]

    operations = [
        migrations.RunPython(install_trigger, remove_trigger),
    ]
