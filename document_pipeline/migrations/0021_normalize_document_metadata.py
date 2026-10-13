from django.db import migrations, models
import django.db.models.deletion


SECTOR_TYPES = [
    'IT and Technology',
    'Real Estate & Construction',
    'Retail & Consumer',
    'Healthcare & Life Sciences',
    'Banking, Financial Services & Insurance (BFSI)',
    'Manufacturing & Industrial',
    'Transportation & Logistics',
    'Professional and Consulting Services',
    'Sales and Distribution',
    'Data Privacy & Intellectual Property',
    'Procurement and Supply Chain',
    'Corporate & Commercial',
    'Contract Lifecycle',
    'Employment and HR',
]

AGREEMENT_TYPES = [
    'Software as a Service Agreement (SaaS)',
    'Software License Agreement',
    'Cloud Services Agreement',
    'Information Technology (IT) Services Agreement / Master Services Agreement (MSA)',
    'Subscription Agreement',
    'Application Programming Interface (API) / Technology Integration Agreement',
    'End User License Agreement (EULA)',
    'Software Development Agreement',
    'Maintenance & Support Agreement',
    'Hosting Agreement',
    'Technology Reseller Agreement',
    'Office Lease Agreement',
    'Retail Lease Agreement',
    'Industrial Lease Agreement',
    'Commercial Lease Agreement',
    'Sublease Agreement',
    'Property Management Agreement',
    'Facilities Management Agreement',
    'Facilities Maintenance Agreement',
    'Construction Agreement',
    'Retail Supply Agreement',
    'E-Commerce Services Agreement',
    'Retail Distribution Agreement',
    'Healthcare Services Agreement / Master Services Agreement (MSA)',
    'Healthcare Provider Agreement',
    'Pharmaceutical Supply Agreement',
    'Business Associate Agreement (BAA)',
    'Manufacturing Agreement',
    'Loan Agreement',
    'Credit Facility Agreement',
    'Financial Technology (FinTech) Services Agreement',
    'Asset Management Agreement',
    'Financing Agreement',
    'Insurance Services Agreement',
    'Reinsurance Agreement',
    'Master Manufacturing Agreement',
    'Original Equipment Manufacturer (OEM) Agreement',
    'Product Supply Agreement',
    'Warehousing Agreement',
    'Third-Party Logistics (3PL) Agreement',
    'Freight Services Agreement',
    'Cold Chain Logistics Agreement',
    'Professional Services Agreement',
    'Consulting Services Agreement',
    'General Master Services Agreement (MSA)',
    'Implementation Agreement',
    'Managed Services Agreement',
    'Business Process Outsourcing (BPO) Agreement',
    'Agency Agreement',
    'Staff Augmentation Agreement',
    'Subcontractor Agreement',
    'Sales Agreement',
    'Sales Representative Agreement',
    'Distribution Agreement',
    'Channel Partner Agreement',
    'Reseller Agreement',
    'Value-Added Reseller (VAR) Agreement',
    'Referral Agreement',
    'Strategic Alliance Agreement',
    'Co-Selling Agreement',
    'Marketplace Agreement',
    'Data Processing / Data Protection Agreement (DPA)',
    'Data Sharing Agreement',
    'Data Protection Addendum',
    'Security Addendum',
    'Information Security Agreement',
    'Sub-processor Agreement',
    'Vendor Agreement',
    'Procurement Services Agreement',
    'Purchase Agreement',
    'Master Supplier Agreement',
    'Supply Agreement',
    'Contract Manufacturing Agreement',
    'Warehousing Agreement',
    'Partnership / Limited Liability Company (LLC) Agreement',
    'Shareholder Agreement',
    'Investment Agreement',
    'Mergers & Acquisitions (M&A) Agreement',
    'Amendment Agreement',
    'Renewal / Extension Agreement',
    'Termination Agreement',
    'Novation Agreement',
    'Assignment Agreement',
    'Waiver Agreement',
    'Independent Contractor / Consultant Agreement',
    'Non-Compete Agreement',
    'Non-Solicitation Agreement',
    'Staffing Services Agreement',
]


def seed_types(apps, schema_editor):
    AgreementType = apps.get_model('document_pipeline', 'AgreementType')
    SectorType = apps.get_model('document_pipeline', 'SectorType')
    Document = apps.get_model('document_pipeline', 'Document')
    alias = schema_editor.connection.alias

    AgreementType.objects.using(alias).bulk_create([
        AgreementType(name=name, sort_order=index)
        for index, name in enumerate(dict.fromkeys(AGREEMENT_TYPES), start=1)
    ])
    SectorType.objects.using(alias).bulk_create([
        SectorType(name=name, sort_order=index)
        for index, name in enumerate(dict.fromkeys(SECTOR_TYPES), start=1)
    ])

    agreement_ids = {
        name.casefold(): pk
        for name, pk in AgreementType.objects.using(alias).values_list('name', 'pk')
    }
    sector_ids = {
        name.casefold(): pk
        for name, pk in SectorType.objects.using(alias).values_list('name', 'pk')
    }
    extra_agreements = {}
    extra_sectors = {}
    for name in Document.objects.using(alias).values_list('agreement_type', flat=True).distinct():
        normalized = (name or '').strip()
        if normalized and normalized.casefold() not in agreement_ids:
            extra_agreements.setdefault(normalized.casefold(), normalized)
    for name in Document.objects.using(alias).values_list(
        'sectorial_category', flat=True,
    ).distinct():
        normalized = (name or '').strip()
        if normalized and normalized.casefold() not in sector_ids:
            extra_sectors.setdefault(normalized.casefold(), normalized)

    AgreementType.objects.using(alias).bulk_create([
        AgreementType(name=name, sort_order=len(AGREEMENT_TYPES) + 1)
        for name in extra_agreements.values()
    ])
    SectorType.objects.using(alias).bulk_create([
        SectorType(name=name, sort_order=len(SECTOR_TYPES) + 1)
        for name in extra_sectors.values()
    ])
    agreement_ids.update({
        name.casefold(): pk
        for name, pk in AgreementType.objects.using(alias).values_list('name', 'pk')
    })
    sector_ids.update({
        name.casefold(): pk
        for name, pk in SectorType.objects.using(alias).values_list('name', 'pk')
    })

    batch = []
    for document in Document.objects.using(alias).all().iterator(chunk_size=500):
        agreement_name = (document.agreement_type or '').strip()
        sector_name = (document.sectorial_category or '').strip()
        if not agreement_name and not sector_name:
            continue
        document.agreement_type_ref_id = agreement_ids.get(agreement_name.casefold())
        document.sector_type_ref_id = sector_ids.get(sector_name.casefold())
        batch.append(document)
        if len(batch) == 500:
            Document.objects.using(alias).bulk_update(
                batch,
                ['agreement_type_ref', 'sector_type_ref'],
                batch_size=250,
            )
            batch.clear()
    if batch:
        Document.objects.using(alias).bulk_update(
            batch,
            ['agreement_type_ref', 'sector_type_ref'],
            batch_size=250,
        )


def restore_type_names(apps, schema_editor):
    Document = apps.get_model('document_pipeline', 'Document')
    alias = schema_editor.connection.alias
    documents = Document.objects.using(alias).select_related(
        'agreement_type_ref', 'sector_type_ref',
    )
    batch = []
    for document in documents.iterator(chunk_size=500):
        document.agreement_type = (
            document.agreement_type_ref.name if document.agreement_type_ref else ''
        )
        document.sectorial_category = (
            document.sector_type_ref.name if document.sector_type_ref else ''
        )
        batch.append(document)
        if len(batch) == 500:
            Document.objects.using(alias).bulk_update(
                batch,
                ['agreement_type', 'sectorial_category'],
                batch_size=250,
            )
            batch.clear()
    if batch:
        Document.objects.using(alias).bulk_update(
            batch,
            ['agreement_type', 'sectorial_category'],
            batch_size=250,
        )


class Migration(migrations.Migration):
    dependencies = [
        ('document_pipeline', '0020_document_extraction_status_published'),
    ]

    operations = [
        migrations.CreateModel(
            name='AgreementType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True)),
                ('sort_order', models.PositiveIntegerField(default=0)),
            ],
            options={
                'db_table': 'agreement_types',
                'ordering': ['sort_order', 'name'],
            },
        ),
        migrations.CreateModel(
            name='SectorType',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                        serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255, unique=True)),
                ('sort_order', models.PositiveIntegerField(default=0)),
            ],
            options={
                'db_table': 'sector_types',
                'ordering': ['sort_order', 'name'],
            },
        ),
        migrations.AddField(
            model_name='document',
            name='agreement_type_ref',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='+', to='document_pipeline.agreementtype'),
        ),
        migrations.AddField(
            model_name='document',
            name='sector_type_ref',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                                    related_name='+', to='document_pipeline.sectortype'),
        ),
        migrations.RunPython(seed_types, restore_type_names),
        migrations.RemoveField(
            model_name='document',
            name='agreement_type',
        ),
        migrations.RemoveField(
            model_name='document',
            name='sectorial_category',
        ),
        migrations.RenameField(
            model_name='document',
            old_name='agreement_type_ref',
            new_name='agreement_type',
        ),
        migrations.RenameField(
            model_name='document',
            old_name='sector_type_ref',
            new_name='sectorial_category',
        ),
        migrations.AlterField(
            model_name='document',
            name='agreement_type',
            field=models.ForeignKey(blank=True, null=True,
                                    on_delete=django.db.models.deletion.PROTECT,
                                    related_name='documents', to='document_pipeline.agreementtype'),
        ),
        migrations.AlterField(
            model_name='document',
            name='sectorial_category',
            field=models.ForeignKey(blank=True, null=True,
                                    on_delete=django.db.models.deletion.PROTECT,
                                    related_name='documents', to='document_pipeline.sectortype'),
        ),
    ]
