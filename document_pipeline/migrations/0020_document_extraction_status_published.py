from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0019_merge_20261005'),
    ]

    operations = [
        migrations.AlterField(
            model_name='document',
            name='extraction_status',
            field=models.CharField(
                choices=[
                    ('pending', 'pending'),
                    ('extracted', 'extracted'),
                    ('extracted_with_warnings', 'extracted_with_warnings'),
                    ('classified', 'classified'),
                    ('published', 'published'),
                    ('rejected', 'rejected'),
                    ('failed', 'failed'),
                ],
                default='pending',
                max_length=32,
            ),
        ),
    ]
