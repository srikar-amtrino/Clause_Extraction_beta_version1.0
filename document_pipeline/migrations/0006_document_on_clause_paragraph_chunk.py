"""Give clauses, paragraphs and chunks a direct document_id.

They reached their document only through their run, so finding one contract's
paragraphs meant a join nobody wants to type in the Neon console. The column is
added nullable, backfilled from the run, then made required.
"""
import django.db.models.deletion
from django.db import migrations, models
from django.db.models import OuterRef, Subquery


def backfill(apps, schema_editor):
    ExtractionRun = apps.get_model('document_pipeline', 'ExtractionRun')
    ChunkRun = apps.get_model('document_pipeline', 'ChunkRun')
    run_document = ExtractionRun.objects.filter(pk=OuterRef('run_id')).values('document_id')[:1]
    for name in ('ExtractedClause', 'ExtractedParagraph'):
        apps.get_model('document_pipeline', name).objects.update(document_id=Subquery(run_document))
    chunk_document = (ChunkRun.objects.filter(pk=OuterRef('chunk_run_id'))
                      .values('extraction_run__document_id')[:1])
    apps.get_model('document_pipeline', 'Chunk').objects.update(document_id=Subquery(chunk_document))


def field(related_name, null):
    return models.ForeignKey(null=null, on_delete=django.db.models.deletion.CASCADE,
                             related_name=related_name, to='document_pipeline.document')


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0005_paragraph_source_segment_unique'),
    ]

    operations = [
        migrations.AddField('extractedclause', 'document', field('extracted_clauses', True)),
        migrations.AddField('extractedparagraph', 'document', field('extracted_paragraphs', True)),
        migrations.AddField('chunk', 'document', field('chunks', True)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        migrations.AlterField('extractedclause', 'document', field('extracted_clauses', False)),
        migrations.AlterField('extractedparagraph', 'document', field('extracted_paragraphs', False)),
        migrations.AlterField('chunk', 'document', field('chunks', False)),
    ]
