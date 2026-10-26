"""Startup checks for settings that end up in fixed-width columns.

SQLite ignores max_length, so a version string that is too long passes every
test and then fails every write on Postgres. Checking at startup turns that
into one clear error before any document is touched.
"""
from django.conf import settings
from django.core.checks import Error, register

# (setting or constant, where it is stored)
_VERSIONED = (
    ('PARSER_BUILD', 'ExtractionRun', 'parser_build'),
    ('CHUNKER_VERSION', 'ChunkRun', 'chunker_version'),
    ('CLASSIFY_TAXONOMY_VERSION', 'ClassificationRun', 'taxonomy_version'),
    ('CLASSIFY_MODEL_ID', 'ClassificationRun', 'model_id'),
)


@register()
def versions_fit_their_columns(app_configs, **kwargs):
    from django.apps import apps

    from document_pipeline.classification.prompt import PROMPT_VERSION

    values = [(name, getattr(settings, name, '') or '', model, field)
              for name, model, field in _VERSIONED]
    values.append(('PROMPT_VERSION', PROMPT_VERSION, 'ClassificationRun', 'prompt_version'))

    errors = []
    for name, value, model, field in values:
        limit = apps.get_model('document_pipeline', model)._meta.get_field(field).max_length
        if limit and len(value) > limit:
            errors.append(Error(
                '%s is %d characters; %s.%s holds at most %d.' % (name, len(value), model, field, limit),
                hint='Shorten %s (currently %r).' % (name, value),
                id='document_pipeline.E001'))
    return errors
