"""Review is saved on the classification row itself.

Save used to append a classification_reviews row per decision. It now updates
the item's own classifications row: the model's answer stays in label /
canonical_type / sub_type, the reviewer's goes into the new review columns,
and `text` holds the clause text (filled in by 0017). The review table goes;
the change history is in the document activity log.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_rename_name_user_username_user_last_login_user_role_and_more'),
        ('document_pipeline', '0015_merge_20260928'),
    ]

    operations = [
        migrations.AddField(
            model_name='classification',
            name='review_decision',
            field=models.CharField(blank=True, choices=[('accepted', 'accepted'), ('corrected', 'corrected'), ('rejected', 'rejected')], max_length=16, null=True),
        ),
        migrations.AddField(
            model_name='classification',
            name='review_note',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='classification',
            name='reviewed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='classification',
            name='reviewed_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='reviewed_classifications', to='core.user'),
        ),
        migrations.AddField(
            model_name='classification',
            name='reviewed_canonical_type',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='reviewed_classifications', to='document_pipeline.canonicaltype'),
        ),
        migrations.AddField(
            model_name='classification',
            name='reviewed_label',
            field=models.CharField(blank=True, choices=[('Clause', 'Clause'), ('Non-clause', 'Non-clause')], max_length=16, null=True),
        ),
        migrations.AddField(
            model_name='classification',
            name='reviewed_sub_type',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='classification',
            name='text',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name='classification',
            index=models.Index(fields=['run', 'review_decision'], name='class_run_decision_idx'),
        ),
        migrations.AddConstraint(
            model_name='classification',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('review_decision', 'corrected'), _negated=True), ('reviewed_canonical_type__isnull', False), _connector='OR'), name='corrected_has_reviewed_type'),
        ),
        migrations.AddConstraint(
            model_name='classification',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('review_decision', 'rejected'), _negated=True), models.Q(('review_note', ''), _negated=True), _connector='OR'), name='rejected_has_review_note'),
        ),
        migrations.AddConstraint(
            model_name='classification',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('reviewed_label', 'Non-clause'), _negated=True), ('reviewed_sub_type__isnull', True), _connector='OR'), name='reviewed_non_clause_has_no_sub_type'),
        ),
        migrations.DeleteModel(
            name='ClassificationReview',
        ),
    ]
