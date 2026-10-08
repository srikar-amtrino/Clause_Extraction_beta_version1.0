import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from document_pipeline.services.embedding_service import (
    count_document_vectors,
    embed_and_upsert,
)


class EmbeddingServiceTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            'QDRANT_URL': 'https://qdrant.example',
            'QDRANT_API_KEY': 'test-key',
            'QDRANT_COLLECTION': 'legal_clauses_v1',
            'EMBEDDING_BATCH_SIZE': '32',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_embeds_and_upserts_records_with_stable_ids_and_metadata(self):
        record = Mock(
            pk='paragraph-record-id',
            reviewed_text='Reviewed clause text',
            paragraph_id='P-001',
            breadcrumb=['1. Terms'],
            source_page=1,
            label='Clause',
            canonical_type='Term',
            sub_type='Duration',
            confidence=0.95,
            chunk=None,
            document=SimpleNamespace(
                name='Agreement.docx',
                agreement_type='Services Agreement',
                sectorial_category='Technology',
            ),
        )
        embedding_response = Mock()
        embedding_response.json.return_value = {'embeddings': [[0.1, 0.2]]}
        qdrant_response = Mock()

        with patch('document_pipeline.services.embedding_service.count_document_vectors',
                   side_effect=[0, 1]), \
                patch('document_pipeline.services.embedding_service.requests.post',
                   return_value=embedding_response) as post, \
                patch('document_pipeline.services.embedding_service.requests.put',
                      return_value=qdrant_response) as put:
            result = embed_and_upsert([record], 'document-id')

        self.assertEqual(result, {
            'embedded': 1,
            'failed': 0,
            'count_before': 0,
            'count_after': 1,
            'added': 1,
            'updated': 0,
        })
        post.assert_called_once_with(
            'http://18.144.172.78:8000/embed',
            json={'texts': ['Reviewed clause text']},
            headers={'Accept': '*/*'},
            timeout=60,
        )
        put.assert_called_once()
        self.assertEqual(
            put.call_args.args[0],
            'https://qdrant.example/collections/legal_clauses_v1/points?wait=true',
        )
        point = put.call_args.kwargs['json']['points'][0]
        self.assertEqual(point['id'], 'paragraph-record-id')
        self.assertEqual(point['vector'], {'dense': [0.1, 0.2]})
        self.assertEqual(point['payload']['vector_id'], 'document-id::P-001')
        self.assertEqual(point['payload']['document_id'], 'document-id')
        self.assertEqual(point['payload']['document_name'], 'Agreement.docx')
        self.assertEqual(point['payload']['agreement_type'], 'Services Agreement')
        self.assertEqual(point['payload']['sectorial_category'], 'Technology')
        self.assertEqual(point['payload']['embedding_dim'], 2)
        self.assertEqual(point['payload']['paragraph_id'], 'P-001')
        self.assertEqual(point['payload']['text'], 'Reviewed clause text')

    def test_counts_qdrant_points_for_the_document(self):
        response = Mock()
        response.json.return_value = {'result': {'count': 0}}

        with patch(
            'document_pipeline.services.embedding_service.requests.post',
            return_value=response,
        ) as post:
            count = count_document_vectors('document-id')

        self.assertEqual(count, 0)
        self.assertEqual(
            post.call_args.args[0],
            'https://qdrant.example/collections/legal_clauses_v1/points/count',
        )
        self.assertEqual(
            post.call_args.kwargs['json'],
            {
                'exact': True,
                'filter': {
                    'must': [
                        {'key': 'document_id', 'match': {'value': 'document-id'}}
                    ],
                },
            },
        )

    def test_rejects_wrong_embedding_count_before_upsert(self):
        embedding_response = Mock()
        embedding_response.json.return_value = {'embeddings': []}
        record = Mock(pk='paragraph-record-id', reviewed_text='Clause')

        with patch('document_pipeline.services.embedding_service.count_document_vectors',
               return_value=0), \
            patch('document_pipeline.services.embedding_service.requests.post',
                   return_value=embedding_response), \
                patch('document_pipeline.services.embedding_service.requests.put') as put:
            with self.assertRaisesRegex(RuntimeError, 'unexpected number'):
                embed_and_upsert([record], 'document-id')

        put.assert_not_called()

    def test_caps_embedding_batches_at_four_for_ec2_latency(self):
        records = [
            Mock(
                pk='paragraph-%d' % index,
                reviewed_text='Clause %d' % index,
                paragraph_id='P-%03d' % index,
                breadcrumb=[],
                source_page=1,
                label='Clause',
                canonical_type='Term',
                sub_type='',
                confidence=None,
                chunk=None,
                document=SimpleNamespace(name='Agreement.docx'),
            )
            for index in range(17)
        ]
        embedding_responses = []
        for batch_start in range(0, len(records), 4):
            batch_size = min(4, len(records) - batch_start)
            response = Mock()
            response.json.return_value = {
                'embeddings': [[0.1, 0.2] for _ in range(batch_size)]
            }
            embedding_responses.append(response)

        with patch(
            'document_pipeline.services.embedding_service.count_document_vectors',
            side_effect=[0, 17],
        ), patch(
            'document_pipeline.services.embedding_service.requests.post',
            side_effect=embedding_responses,
        ) as post, patch(
            'document_pipeline.services.embedding_service.requests.put',
            return_value=Mock(),
        ) as put:
            result = embed_and_upsert(records, 'document-id')

        self.assertEqual(result['embedded'], 17)
        self.assertEqual(result['added'], 17)
        self.assertEqual(post.call_count, 5)
        self.assertEqual(
            [len(call.kwargs['json']['texts']) for call in post.call_args_list],
            [4, 4, 4, 4, 1],
        )
        self.assertEqual(put.call_count, 1)