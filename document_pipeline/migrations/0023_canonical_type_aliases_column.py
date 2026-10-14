from django.db import migrations, models
import django.db.models.deletion


def copy_aliases_to_canonical_types(apps, schema_editor):
    CanonicalType = apps.get_model('document_pipeline', 'CanonicalType')
    CanonicalTypeAlias = apps.get_model('document_pipeline', 'CanonicalTypeAlias')
    alias = schema_editor.connection.alias

    aliases_by_type = {}
    for type_id, name, match_key, is_literal, note in (
        CanonicalTypeAlias.objects.using(alias)
        .order_by('canonical_type_id', 'position')
        .values_list('canonical_type_id', 'alias', 'match_key', 'is_literal', 'note')
    ):
        aliases_by_type.setdefault(type_id, []).append({
            'alias': name,
            'match_key': match_key,
            'is_literal': is_literal,
            'note': note,
        })

    canonical_types = list(CanonicalType.objects.using(alias).all())
    for canonical_type in canonical_types:
        canonical_type.aliases = aliases_by_type.get(canonical_type.pk, [])
    CanonicalType.objects.using(alias).bulk_update(canonical_types, ['aliases'])


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0022_canonical_type_agreement_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='canonicaltypealias',
            name='canonical_type',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='alias_rows',
                to='document_pipeline.canonicaltype',
            ),
        ),
        migrations.AddField(
            model_name='canonicaltype',
            name='aliases',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(copy_aliases_to_canonical_types, migrations.RunPython.noop),
    ]
