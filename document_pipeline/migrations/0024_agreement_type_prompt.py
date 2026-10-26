from django.db import migrations, models
import django.db.models.deletion


MSA_AGREEMENT_TYPE = (
    'Information Technology (IT) Services Agreement / Master Services Agreement (MSA)'
)


def seed_msa_prompt(apps, schema_editor):
    AgreementType = apps.get_model('document_pipeline', 'AgreementType')
    AgreementTypePrompt = apps.get_model('document_pipeline', 'AgreementTypePrompt')
    alias = schema_editor.connection.alias
    agreement_type = AgreementType.objects.using(alias).get(name=MSA_AGREEMENT_TYPE)

    from document_pipeline.classification.prompt import render_system_prompt
    from document_pipeline.classification.taxonomy import vocabulary_from_file

    AgreementTypePrompt.objects.using(alias).create(
        agreement_type_id=agreement_type.pk,
        prompt=render_system_prompt(vocabulary_from_file('v1')),
    )


def unseed_msa_prompt(apps, schema_editor):
    AgreementTypePrompt = apps.get_model('document_pipeline', 'AgreementTypePrompt')
    alias = schema_editor.connection.alias
    AgreementTypePrompt.objects.using(alias).filter(
        agreement_type__name=MSA_AGREEMENT_TYPE,
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0023_canonical_type_aliases_column'),
    ]

    operations = [
        migrations.CreateModel(
            name='AgreementTypePrompt',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('prompt', models.TextField()),
                ('agreement_type', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='classification_prompt',
                    to='document_pipeline.agreementtype',
                )),
            ],
            options={
                'db_table': 'agreement_type_prompts',
            },
        ),
        migrations.RunPython(seed_msa_prompt, unseed_msa_prompt),
    ]
