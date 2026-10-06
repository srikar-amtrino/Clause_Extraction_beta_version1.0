"""A reviewer can delete a clause from the review workspace.

The row is kept and marked: deleted_at / deleted_by say when and by whom, and
merged_into names the clause its text was moved into, if any. Nullable columns
only, so existing rows are untouched.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_rename_name_user_username_user_last_login_user_role_and_more'),
        ('document_pipeline', '0017_classification_text_backfill'),
    ]

    operations = [
        migrations.AddField(
            model_name='classification',
            name='deleted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='classification',
            name='deleted_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='deleted_classifications', to='core.user'),
        ),
        migrations.AddField(
            model_name='classification',
            name='merged_into',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='merged_from', to='document_pipeline.classification'),
        ),
    ]
