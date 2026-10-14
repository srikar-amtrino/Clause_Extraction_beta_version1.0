import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


def reconcile_agreement_scoped_taxonomies(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor not in {'postgresql', 'sqlite'}:
        raise RuntimeError(
            'Agreement-scoped taxonomy migration supports PostgreSQL and SQLite.'
        )

    CanonicalTypeAlias = apps.get_model(
        'document_pipeline', 'CanonicalTypeAlias'
    )
    AgreementType = apps.get_model('document_pipeline', 'AgreementType')
    CanonicalType = apps.get_model('document_pipeline', 'CanonicalType')
    alias_table = CanonicalTypeAlias._meta.db_table
    quote = schema_editor.quote_name

    if connection.vendor == 'sqlite':
        for model, constraint_names in (
            (
                CanonicalType,
                {
                    'unique_canonical_type_key',
                    'unique_canonical_type_name',
                    'unique_canonical_type_number',
                },
            ),
            (CanonicalTypeAlias, {'unique_literal_alias_match_key'}),
        ):
            original_constraints = model._meta.constraints
            constraints_to_remove = [
                item for item in original_constraints
                if item.name in constraint_names
            ]
            if constraints_to_remove:
                model._meta.constraints = [
                    item for item in original_constraints
                    if item.name not in constraint_names
                ]
                try:
                    schema_editor.remove_constraint(
                        model, constraints_to_remove[0]
                    )
                finally:
                    model._meta.constraints = original_constraints

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(
                cursor, alias_table
            )
        }
        if 'agreement_type_id' not in columns:
            agreement_type_field = models.ForeignKey(
                AgreementType,
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='canonical_type_aliases',
            )
            agreement_type_field.set_attributes_from_name('agreement_type')
            agreement_type_field.model = CanonicalTypeAlias
            schema_editor.add_field(CanonicalTypeAlias, agreement_type_field)

        cursor.execute(
            f'UPDATE {quote(alias_table)} AS alias '
            f'SET agreement_type_id = canonical.agreement_type_id '
            f'FROM {quote("canonical_types")} AS canonical '
            'WHERE alias.canonical_type_id = canonical.id '
            'AND alias.agreement_type_id IS DISTINCT FROM canonical.agreement_type_id'
        )

        legacy_indexes = (
            'unique_canonical_type_key',
            'unique_canonical_type_name',
            'unique_canonical_type_number',
            'unique_literal_alias_match_key',
        )
        for index_name in legacy_indexes:
            table_name = (
                alias_table
                if index_name == 'unique_literal_alias_match_key'
                else 'canonical_types'
            )
            if connection.vendor == 'postgresql':
                cursor.execute(
                    f'ALTER TABLE {quote(table_name)} '
                    f'DROP CONSTRAINT IF EXISTS {quote(index_name)}'
                )
            cursor.execute(f'DROP INDEX IF EXISTS {quote(index_name)}')

        scoped_indexes = (
            (
                'unique_ctype_key_global',
                'canonical_types',
                'version, key',
                'agreement_type_id IS NULL',
            ),
            (
                'unique_ctype_key_agreement',
                'canonical_types',
                'version, agreement_type_id, key',
                'agreement_type_id IS NOT NULL',
            ),
            (
                'unique_ctype_name_global',
                'canonical_types',
                'version, name',
                'agreement_type_id IS NULL',
            ),
            (
                'unique_ctype_name_agreement',
                'canonical_types',
                'version, agreement_type_id, name',
                'agreement_type_id IS NOT NULL',
            ),
            (
                'unique_ctype_number_global',
                'canonical_types',
                'version, applies_to, number',
                'agreement_type_id IS NULL',
            ),
            (
                'unique_ctype_number_agreement',
                'canonical_types',
                'version, agreement_type_id, applies_to, number',
                'agreement_type_id IS NOT NULL',
            ),
            (
                'unique_alias_global',
                alias_table,
                'version, match_key',
                'is_literal AND agreement_type_id IS NULL',
            ),
            (
                'unique_alias_agreement',
                alias_table,
                'version, agreement_type_id, match_key',
                'is_literal AND agreement_type_id IS NOT NULL',
            ),
        )
        for index_name, table_name, fields, condition in scoped_indexes:
            cursor.execute(
                f'CREATE UNIQUE INDEX IF NOT EXISTS {quote(index_name)} '
                f'ON {quote(table_name)} ({fields}) WHERE {condition}'
            )


class Migration(migrations.Migration):

    dependencies = [
        ('document_pipeline', '0025_exhibits'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    reconcile_agreement_scoped_taxonomies,
                    migrations.RunPython.noop,
                ),
            ],
            state_operations=[
                migrations.RemoveConstraint(
                    model_name='canonicaltype',
                    name='unique_canonical_type_key',
                ),
                migrations.RemoveConstraint(
                    model_name='canonicaltype',
                    name='unique_canonical_type_name',
                ),
                migrations.RemoveConstraint(
                    model_name='canonicaltype',
                    name='unique_canonical_type_number',
                ),
                migrations.AddField(
                    model_name='canonicaltypealias',
                    name='agreement_type',
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='canonical_type_aliases',
                        to='document_pipeline.agreementtype',
                    ),
                ),
                migrations.RemoveConstraint(
                    model_name='canonicaltypealias',
                    name='unique_literal_alias_match_key',
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=True),
                        fields=('version', 'key'),
                        name='unique_ctype_key_global',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=False),
                        fields=('version', 'agreement_type', 'key'),
                        name='unique_ctype_key_agreement',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=True),
                        fields=('version', 'name'),
                        name='unique_ctype_name_global',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=False),
                        fields=('version', 'agreement_type', 'name'),
                        name='unique_ctype_name_agreement',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=True),
                        fields=('version', 'applies_to', 'number'),
                        name='unique_ctype_number_global',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltype',
                    constraint=models.UniqueConstraint(
                        condition=Q(agreement_type__isnull=False),
                        fields=('version', 'agreement_type', 'applies_to', 'number'),
                        name='unique_ctype_number_agreement',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltypealias',
                    constraint=models.UniqueConstraint(
                        condition=Q(is_literal=True, agreement_type__isnull=True),
                        fields=('version', 'match_key'),
                        name='unique_alias_global',
                    ),
                ),
                migrations.AddConstraint(
                    model_name='canonicaltypealias',
                    constraint=models.UniqueConstraint(
                        condition=Q(is_literal=True, agreement_type__isnull=False),
                        fields=('version', 'agreement_type', 'match_key'),
                        name='unique_alias_agreement',
                    ),
                ),
            ],
        ),
    ]
