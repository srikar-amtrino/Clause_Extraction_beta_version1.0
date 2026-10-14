from django.db import migrations, models
import django.db.models.deletion


MSA_AGREEMENT_TYPE = (
    'Information Technology (IT) Services Agreement / Master Services Agreement (MSA)'
)


def assign_existing_types_to_msa(apps, schema_editor):
    AgreementType = apps.get_model('document_pipeline', 'AgreementType')
    CanonicalType = apps.get_model('document_pipeline', 'CanonicalType')
    alias = schema_editor.connection.alias

    agreement_type = AgreementType.objects.using(alias).get(name=MSA_AGREEMENT_TYPE)
    CanonicalType.objects.using(alias).filter(
        agreement_type__isnull=True,
    ).update(agreement_type_id=agreement_type.pk)


def unassign_existing_types(apps, schema_editor):
    AgreementType = apps.get_model('document_pipeline', 'AgreementType')
    CanonicalType = apps.get_model('document_pipeline', 'CanonicalType')
    alias = schema_editor.connection.alias

    agreement_type = AgreementType.objects.using(alias).get(name=MSA_AGREEMENT_TYPE)
    CanonicalType.objects.using(alias).filter(
        agreement_type_id=agreement_type.pk,
    ).update(agreement_type=None)


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0021_normalize_document_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='canonicaltype',
            name='agreement_type',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='canonical_types',
                to='document_pipeline.agreementtype',
            ),
        ),
        migrations.RunPython(assign_existing_types_to_msa, unassign_existing_types),
    ]
