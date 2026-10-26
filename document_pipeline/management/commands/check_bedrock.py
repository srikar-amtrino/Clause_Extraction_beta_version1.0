"""Prove Bedrock classification works in this environment, without touching data.

    python manage.py check_bedrock

Sends the real system prompt and a two-paragraph synthetic section, twice.
The first request shows the credentials, region and model work and that the
structured answer validates; the second should read the system prompt from
the prompt cache. Reads the taxonomy from its data file, so it does not
depend on migrations having run. Writes nothing and never prints credentials.
"""
import json

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from document_pipeline.classification import prompt as prompts
from document_pipeline.classification.batching import Batch, Group, Paragraph
from document_pipeline.classification.bedrock_client import (
    ConfigurationError,
    TransientError,
    classifier_from_settings,
)
from document_pipeline.classification.schema import output_schema
from document_pipeline.classification.taxonomy import vocabulary_from_file

SECTION = Group(
    key='c9', section='9 Term and Termination', preview='9. Term and Termination',
    paragraphs=(
        Paragraph(chunk_id='check-1', local_id='chunk_c10_micro', order_index=1, number='9.1',
                  title='Initial Term', heading_trail='9 Term and Termination > 9.1 Initial Term',
                  lead_in=None, region='body',
                  text='This Agreement commences on the Effective Date and continues for '
                       'three (3) years.'),
        Paragraph(chunk_id='check-2', local_id='chunk_c11_micro', order_index=2, number='9.2',
                  title=None, heading_trail='9 Term and Termination > 9.2',
                  lead_in=None, region='body',
                  text='Either party may terminate this Agreement for material breach on thirty '
                       '(30) days written notice if the breach is not cured.'),
    ))


class Command(BaseCommand):
    help = "Send a small synthetic classification to Bedrock and report what happened."

    def handle(self, *args, **options):
        try:
            classifier = classifier_from_settings()
        except ConfigurationError as exc:
            raise CommandError(str(exc))
        vocab = vocabulary_from_file(settings.CLASSIFY_TAXONOMY_VERSION)
        schema = output_schema(vocab)
        system = prompts.system_blocks(prompts.render_system_prompt(vocab))
        batch = Batch(0, (SECTION,))
        message = prompts.render_user_message(batch, document_title='Connectivity check',
                                              contract_type='MSA')

        self.stdout.write('client    %s' % classifier.client_kind)
        self.stdout.write('region    %s' % classifier.region)
        self.stdout.write('model     %s' % classifier.model_id)
        self.stdout.write('taxonomy  %s (%d types), prompt %s'
                          % (vocab.version, len(vocab.types), prompts.PROMPT_VERSION))

        for attempt in (1, 2):
            try:
                call = classifier.complete(system, message, schema.output_config_format())
            except (ConfigurationError, TransientError) as exc:
                raise CommandError('request %d failed: %s' % (attempt, exc))
            self.stdout.write('')
            self.stdout.write('request %d: %d ms, stop_reason=%s, request_id=%s'
                              % (attempt, call.latency_ms, call.stop_reason, call.request_id))
            self.stdout.write('  tokens: input %d, output %d, cache write %d, cache read %d'
                              % (call.input_tokens, call.output_tokens,
                                 call.cache_write_tokens, call.cache_read_tokens))
            if attempt == 1:
                self._show_answer(call.text, schema, batch)

        if call.cache_read_tokens:
            self.stdout.write(self.style.SUCCESS('\nOK: structured output validated and the '
                                                 'system prompt was read from cache.'))
        else:
            self.stdout.write(self.style.WARNING(
                '\nOK, but the second request did not read from cache. Classification works; '
                'it will cost more than it should until caching is understood.'))

    def _show_answer(self, text, schema, batch):
        try:
            items = json.loads(text or '')['items']
            parsed = [schema.item_adapter.validate_python(item) for item in items]
        except Exception as exc:
            raise CommandError('the answer did not validate: %s\n%s' % (exc, text))
        for item in parsed:
            paragraph = batch.ids.get(item.id)
            self.stdout.write('  %s %-4s -> %s | %s | %s | %.2f'
                              % (item.id, paragraph.number if paragraph else '?', item.label,
                                 item.canonical_type, getattr(item, 'sub_type', None),
                                 item.confidence))
            self.stdout.write('       reason: %s' % item.reason)
