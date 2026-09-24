"""Make classification_calls.document_id and classification_reviews.document_id
required. On a database that already had them required, this only re-asserts
what is there."""
import django.db.models.deletion
from django.db import migrations, models


def field(related_name):
    return models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                             related_name=related_name, to='document_pipeline.document')


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0013_classificationcall_classificationreview_document'),
    ]

    operations = [
        migrations.AlterField('classificationcall', 'document', field('classification_calls')),
        migrations.AlterField('classificationreview', 'document',
                              field('classification_reviews')),
    ]
