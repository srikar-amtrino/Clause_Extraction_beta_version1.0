"""The shape the model must answer in, built from the vocabulary.

Sent as a JSON schema through structured outputs, so the API constrains the
model while it writes: canonical_type can only be a listed name, a Clause can
only take a clause type, and a Non-clause has no sub_type field to fill in.

The same models validate the answer again on this side. Some rules cannot be
expressed to the API: it has no numeric bounds, so the SDK moves confidence's
0-1 range into the description as a hint. And a fallback model or a future
client may enforce less than today's does.

A single-value Literal is normally emitted as `const`, which the API schema
does not support; the SDK would drop it into the description and leave the
label unconstrained. Each label therefore also carries an explicit one-value
`enum`, which survives the transform and is enforced.
"""
import threading
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

import anthropic


class OutputSchema:
    """Everything built from one vocabulary version, built once."""

    def __init__(self, vocab):
        clause_type = Literal[vocab.clause_names]
        non_clause_type = Literal[vocab.non_clause_names]

        class ClauseItem(BaseModel):
            model_config = ConfigDict(extra='forbid')

            id: str = Field(description='The paragraph id exactly as given, e.g. p3.')
            label: Literal['Clause'] = Field(json_schema_extra={'enum': ['Clause']})
            canonical_type: Optional[clause_type] = Field(
                description='One of the clause types. null only when the paragraph is a '
                            'clause and no clause type fits it.')
            sub_type: str = Field(
                description="The paragraph's own title if it has one, otherwise a 2-4 word "
                            'Title Case description of what it does.')
            confidence: float = Field(
                ge=0.0, le=1.0,
                description='Probability that both label and canonical_type are right.')
            reason: str = Field(
                description='One sentence naming the wording or context that decided it.')

        class NonClauseItem(BaseModel):
            model_config = ConfigDict(extra='forbid')

            id: str = Field(description='The paragraph id exactly as given, e.g. p3.')
            label: Literal['Non-clause'] = Field(json_schema_extra={'enum': ['Non-clause']})
            canonical_type: non_clause_type = Field(description='One of the non-clause types.')
            confidence: float = Field(
                ge=0.0, le=1.0,
                description='Probability that both label and canonical_type are right.')
            reason: str = Field(
                description='One sentence naming the wording or context that decided it.')

        class ClassificationBatch(BaseModel):
            model_config = ConfigDict(extra='forbid')

            items: list[Union[ClauseItem, NonClauseItem]] = Field(
                description='Exactly one item per paragraph id in the input.')

        self.version = vocab.version
        self.clause_item = ClauseItem
        self.non_clause_item = NonClauseItem
        self.batch = ClassificationBatch
        # Items are validated one at a time, so one bad item costs a retry of
        # that item rather than of the whole batch.
        self.item_adapter = TypeAdapter(Union[ClauseItem, NonClauseItem])
        # Deterministic for a given vocabulary, so the API compiles it once and
        # reuses the compiled grammar across every request.
        self.json_schema = anthropic.transform_schema(ClassificationBatch)

    def output_config_format(self):
        return {'type': 'json_schema', 'schema': self.json_schema}


_schemas = {}
_lock = threading.Lock()


def output_schema(vocab):
    """The OutputSchema for a vocabulary, built once per version."""
    with _lock:
        schema = _schemas.get(vocab.version)
        if schema is None:
            schema = _schemas[vocab.version] = OutputSchema(vocab)
        return schema
