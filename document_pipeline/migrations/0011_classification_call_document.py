from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0010_merge_0007_review_workspace_0009_classificationreview'),
    ]

    operations = [
        migrations.AddField(
            model_name='classificationcall',
            name='document',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='classification_calls',
                to='document_pipeline.document',
            ),
        ),
    ]