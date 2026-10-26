"""Make (run, source_paragraph_index, segment_index) the unique paragraph key.

Pieces split out of one source paragraph share its index, so the old
(run, source_paragraph_index) constraint rejected every document with an inline
split and rolled the whole persist back. That old constraint is dropped by
0002; this migration only adds the replacement.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0004_seed_taxonomy_v1'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='extractedparagraph',
            constraint=models.UniqueConstraint(fields=('run', 'source_paragraph_index', 'segment_index'),
                                               name='unique_para_source_segment'),
        ),
    ]
