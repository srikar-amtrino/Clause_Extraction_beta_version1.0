import json
from datetime import timedelta

from django.utils import timezone
from django.test import RequestFactory, TestCase

from core.models import IngestionSource, User, UserSession
from document_pipeline.classification import prompt as prompts
from document_pipeline.classification.taxonomy import (
    clear_vocabulary_cache,
    load_vocabulary,
)
from document_pipeline.document_views import _document_row, document_metadata
from document_pipeline.models import AgreementType, CanonicalType, Document, SectorType
from document_pipeline.models import AgreementTypePrompt
from document_pipeline.services.classification_service import system_prompt_for_document
from document_pipeline.services.document_metadata import (
    resolve_agreement_type,
    resolve_sector_type,
)
from document_pipeline.taxonomy_api_views import (
    canonical_type_collection,
    canonical_type_detail,
)


class DocumentMetadataTests(TestCase):
    def test_canonical_taxonomy_api_reads_creates_and_edits_agreement_scoped_types(self):
        msa = AgreementType.objects.get(
            name='Information Technology (IT) Services Agreement / Master Services Agreement (MSA)',
        )
        cloud = AgreementType.objects.get(name='Cloud Services Agreement')
        user = User.objects.create(
            email='canonical-taxonomy-api@example.com',
            username='canonical-taxonomy-api',
        )
        UserSession.objects.create(
            user=user,
            token='canonical-taxonomy-api-token',
            expires_at=timezone.now() + timedelta(days=1),
        )
        payload = {
            'agreement_type_id': cloud.pk,
            'applies_to': 'clause',
            'number': 1,
            'key': 'definitions-and-interpretation',
            'name': 'Definitions & Interpretation',
            'definition': 'Cloud-specific definitions and interpretation.',
            'aliases': ['Cloud Definitions'],
            'excludes': [],
        }
        request = RequestFactory().post(
            '/api/taxonomy/types/',
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_AUTHORIZATION='Bearer canonical-taxonomy-api-token',
        )
        created_response = canonical_type_collection(request)
        self.assertEqual(created_response.status_code, 201, created_response.content)
        created = json.loads(created_response.content)
        self.assertEqual(created['agreement_type'], {'id': cloud.pk, 'name': cloud.name})

        existing_msa_type = CanonicalType.objects.get(
            version='v1',
            agreement_type=msa,
            key='definitions-and-interpretation',
        )
        self.assertNotEqual(created['id'], str(existing_msa_type.pk))

        patch_request = RequestFactory().patch(
            '/api/taxonomy/types/%s/' % created['id'],
            data=json.dumps({'definition': 'Updated cloud-specific definition.'}),
            content_type='application/json',
            HTTP_AUTHORIZATION='Bearer canonical-taxonomy-api-token',
        )
        patched_response = canonical_type_detail(patch_request, created['id'])
        self.assertEqual(patched_response.status_code, 200, patched_response.content)
        patched = json.loads(patched_response.content)
        self.assertEqual(patched['definition'], 'Updated cloud-specific definition.')
        self.assertEqual(patched['aliases'], ['Cloud Definitions'])

        duplicate_request = RequestFactory().post(
            '/api/taxonomy/types/',
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_AUTHORIZATION='Bearer canonical-taxonomy-api-token',
        )
        duplicate_response = canonical_type_collection(duplicate_request)
        self.assertEqual(duplicate_response.status_code, 409)

        get_response = canonical_type_collection(
            RequestFactory().get('/api/taxonomy/types/'),
        )
        self.assertEqual(get_response.status_code, 200)
        data = json.loads(get_response.content)
        self.assertIn(
            {'id': cloud.pk, 'name': cloud.name},
            data['agreement_types'],
        )
        self.assertTrue(data['sector_types'])
        self.assertIn(created['id'], {row['id'] for row in data['canonical_types']})

    def test_metadata_endpoint_returns_seeded_types_and_ids(self):
        response = document_metadata(RequestFactory().get('/api/document-metadata/'))
        payload = json.loads(response.content)

        self.assertEqual(len(payload['agreement_types']), 87)
        self.assertEqual(len(payload['sector_types']), 14)
        self.assertIn(
            {'id': AgreementType.objects.get(name='Software License Agreement').pk,
             'name': 'Software License Agreement'},
            payload['agreement_types'],
        )
        self.assertIn(
            {'id': SectorType.objects.get(name='IT and Technology').pk,
             'name': 'IT and Technology'},
            payload['sector_types'],
        )

    def test_metadata_resolver_accepts_ids_and_legacy_names(self):
        agreement = AgreementType.objects.get(name='Cloud Services Agreement')
        sector = SectorType.objects.get(name='Healthcare & Life Sciences')

        self.assertEqual(resolve_agreement_type(str(agreement.pk)), agreement)
        self.assertEqual(resolve_agreement_type(agreement.name), agreement)
        self.assertEqual(resolve_sector_type(str(sector.pk)), sector)
        self.assertEqual(resolve_sector_type(sector.name), sector)

    def test_document_response_includes_lookup_ids_and_display_names(self):
        source = IngestionSource.objects.create(
            name='document-metadata-test',
            source_type='test',
        )
        agreement = AgreementType.objects.get(name='Cloud Services Agreement')
        sector = SectorType.objects.get(name='Healthcare & Life Sciences')
        document = Document.objects.create(
            ingestion_source=source,
            source_external_id='metadata-test',
            name='Metadata test',
            agreement_type=agreement,
            sectorial_category=sector,
        )

        response = _document_row(
            document,
            None,
            None,
            reviewers_by_doc={document.id: []},
        )

        self.assertEqual(response['agreement_type'], agreement.name)
        self.assertEqual(response['agreement_type_id'], agreement.pk)
        self.assertEqual(response['sectorial_category'], sector.name)
        self.assertEqual(response['sectorial_category_id'], sector.pk)

    def test_document_taxonomy_returns_only_types_for_its_agreement(self):
        source = IngestionSource.objects.create(
            name='document-taxonomy-test',
            source_type='test',
        )
        msa = AgreementType.objects.get(
            name='Information Technology (IT) Services Agreement / Master Services Agreement (MSA)',
        )
        cloud = AgreementType.objects.get(name='Cloud Services Agreement')
        document = Document.objects.create(
            ingestion_source=source,
            source_external_id='taxonomy-test',
            name='Taxonomy test',
            agreement_type=msa,
        )
        CanonicalType.objects.create(
            version='test',
            applies_to=CanonicalType.CLAUSE,
            number=1,
            key='cloud-only',
            name='Cloud Only',
            definition='Cloud-only taxonomy type.',
            agreement_type=cloud,
        )

        response = self.client.get('/api/%s/taxonomy/' % document.pk)
        payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['agreement_type'], {'id': msa.pk, 'name': msa.name})
        self.assertEqual(len(payload['clause_types']), 35)
        self.assertEqual(len(payload['non_clause_types']), 11)
        self.assertNotIn(
            'cloud-only',
            {item['key'] for item in payload['clause_types']},
        )
        self.assertNotIn('aliases', payload['clause_types'][0])
        self.assertTrue(all(
            item.agreement_type_id == msa.pk
            for item in CanonicalType.objects.filter(version='v1')
        ))

        unscoped_response = self.client.get('/api/taxonomy/')
        self.assertEqual(unscoped_response.status_code, 200)
        self.assertNotIn(
            'aliases',
            unscoped_response.json()['clause_types'][0],
        )

        document.agreement_type = cloud
        document.save(update_fields=['agreement_type'])
        empty_response = self.client.get('/api/%s/taxonomy/' % document.pk)
        self.assertEqual(empty_response.status_code, 200)
        self.assertEqual(empty_response.json()['clause_types'], [])
        self.assertEqual(empty_response.json()['non_clause_types'], [])

    def test_aliases_are_stored_on_canonical_type(self):
        definitions = CanonicalType.objects.get(
            version='v1',
            key='definitions-and-interpretation',
        )
        self.assertEqual(
            definitions.aliases,
            [
                {
                    'alias': 'Definitions',
                    'match_key': 'definitions',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Definitions and Interpretation',
                    'match_key': 'definitions and interpretation',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Certain Definitions',
                    'match_key': 'certain definitions',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Defined Terms',
                    'match_key': 'defined terms',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Construction',
                    'match_key': 'construction',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Rules of Construction',
                    'match_key': 'rules of construction',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Interpretation',
                    'match_key': 'interpretation',
                    'is_literal': True,
                    'note': '',
                },
                {
                    'alias': 'Glossary',
                    'match_key': 'glossary',
                    'is_literal': True,
                    'note': '',
                },
            ],
        )
        clear_vocabulary_cache()
        self.assertEqual(load_vocabulary('v1').canonicalize('SOS').key,
                         'purpose-and-scope-of-services')

    def test_classification_uses_prompt_for_document_agreement_type(self):
        source = IngestionSource.objects.create(
            name='agreement-prompt-test',
            source_type='test',
        )
        msa = AgreementType.objects.get(
            name='Information Technology (IT) Services Agreement / Master Services Agreement (MSA)',
        )
        cloud = AgreementType.objects.get(name='Cloud Services Agreement')
        msa_document = Document.objects.create(
            ingestion_source=source,
            source_external_id='msa-prompt-test',
            name='MSA prompt test',
            agreement_type=msa,
        )
        cloud_document = Document.objects.create(
            ingestion_source=source,
            source_external_id='cloud-prompt-test',
            name='Cloud prompt test',
            agreement_type=cloud,
        )
        stored_prompt = AgreementTypePrompt.objects.get(agreement_type=msa)
        vocab = load_vocabulary('v1')

        self.assertEqual(
            system_prompt_for_document(msa_document.pk, vocab),
            stored_prompt.prompt,
        )
        self.assertEqual(
            system_prompt_for_document(cloud_document.pk, vocab),
            prompts.render_system_prompt(vocab),
        )
