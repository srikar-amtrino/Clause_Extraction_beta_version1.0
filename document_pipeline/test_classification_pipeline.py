import json
import uuid
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from document_pipeline.classification.batching import Batch, Group, Paragraph
from document_pipeline.classification.schema import output_schema
from document_pipeline.classification.taxonomy import vocabulary_from_file
from document_pipeline.models import Classification, ClassificationCall, ClassificationRun
from document_pipeline.services import classification_service


def sample_batch():
    paragraph = Paragraph(
        chunk_id=str(uuid.uuid4()),
        local_id='chunk_test_micro',
        order_index=1,
        number='1.1',
        title='Initial Term',
        heading_trail='1 Term > 1.1 Initial Term',
        lead_in=None,
        region='body',
        text='This Agreement begins on the Effective Date and continues for one year.',
    )
    return Batch(0, (Group(
        key='1',
        section='1 Term',
        preview='Term',
        paragraphs=(paragraph,),
    ),))


class ClassificationPipelineTests(SimpleTestCase):
    def test_mocked_llm_output_is_validated_and_printed(self):
        batch = sample_batch()
        vocabulary = vocabulary_from_file('v1')
        schema = output_schema(vocabulary)
        llm_output = json.dumps({'items': [{
            'id': 'p1',
            'label': 'Clause',
            'canonical_type': vocabulary.clause_names[0],
            'sub_type': 'Initial Term',
            'confidence': 0.97,
            'reason': 'The paragraph states the agreement duration.',
        }]})
        classifier = MagicMock()
        classifier.complete.return_value = SimpleNamespace(
            stop_reason='end_turn',
            request_id='test-request',
            input_tokens=12,
            output_tokens=20,
            cache_read_tokens=0,
            cache_write_tokens=0,
            latency_ms=3,
            text=llm_output,
        )
        context = classification_service.RunContext(
            vocab=vocabulary,
            schema=schema,
            system=[],
            document_title='Test contract',
            contract_type='MSA',
            max_attempts=1,
        )

        resolution = classification_service.resolve_batch(
            batch, classifier=classifier, context=context)

        print('LLM OUTPUT:', llm_output, flush=True)
        self.assertEqual(len(resolution.results), 1)
        self.assertEqual(resolution.results[batch.paragraphs[0].chunk_id].outcome,
                         Classification.CLASSIFIED)
        self.assertEqual(resolution.calls[0].request_id, 'test-request')

    def test_database_updates_include_document_id(self):
        batch = sample_batch()
        vocabulary = vocabulary_from_file('v1')
        document_id = uuid.uuid4()
        run = ClassificationRun(document_id=document_id)
        result = classification_service.ItemResult(
            outcome=Classification.CLASSIFIED,
            label=Classification.CLAUSE,
            type_key=vocabulary.clause_types[0].key,
            sub_type='Initial Term',
            confidence=0.97,
            reason='The paragraph states the agreement duration.',
        )
        resolution = classification_service.BatchResolution(
            batch=batch,
            results={batch.paragraphs[0].chunk_id: result},
            calls=[classification_service.CallRecord(
                batch_index=0,
                attempt=1,
                chunk_ids=[batch.paragraphs[0].chunk_id],
                status=ClassificationCall.SUCCEEDED,
                stop_reason='end_turn',
                request_id='test-request',
                input_tokens=12,
                output_tokens=20,
                cache_read_tokens=0,
                cache_write_tokens=0,
                latency_ms=3,
                raw_output='{"items": []}',
            )],
        )

        canonical_types = MagicMock()
        canonical_types.values_list.return_value = [(vocabulary.clause_types[0].key, uuid.uuid4())]
        classifications = MagicMock()
        classifications.values_list.return_value = []
        chunks = MagicMock()
        chunks.values_list.return_value = [(batch.paragraphs[0].chunk_id, ['P-1'])]

        with patch.object(classification_service.CanonicalType.objects, 'filter',
                          return_value=canonical_types), \
             patch.object(classification_service.Classification.objects, 'filter',
                          return_value=classifications), \
             patch.object(classification_service.Chunk.objects, 'filter',
                          return_value=chunks), \
             patch.object(classification_service.Classification.objects, 'bulk_create') as save_rows, \
             patch.object(classification_service.ClassificationCall.objects, 'bulk_create') as save_calls, \
             patch.object(classification_service.transaction, 'atomic',
                          return_value=nullcontext()):
            classification_service.write_resolution(run, resolution, vocab=vocabulary)

        saved_row = save_rows.call_args.args[0][0]
        saved_call = save_calls.call_args.args[0][0]
        print('DATABASE UPDATE classification:', {
            'document_id': str(saved_row.document_id),
            'chunk_id': str(saved_row.chunk_id),
            'needs_review': saved_row.needs_review,
            'review_reasons': saved_row.review_reasons,
        }, flush=True)
        print('DATABASE UPDATE classification_call:', {
            'document_id': str(getattr(saved_call, 'document_id', None)),
            'request_id': saved_call.request_id,
            'status': saved_call.status,
        }, flush=True)
        self.assertEqual(saved_row.document_id, document_id)
        self.assertEqual(getattr(saved_call, 'document_id', None), document_id)