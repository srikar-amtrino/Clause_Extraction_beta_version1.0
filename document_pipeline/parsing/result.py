"""Typed output of the extractor."""
from dataclasses import asdict, dataclass, field

SCHEMA_VERSION = "1.0"

EXTRACTED = "extracted"
EXTRACTED_WITH_WARNINGS = "extracted_with_warnings"
REJECTED = "rejected"
FAILED = "failed"


@dataclass
class ParagraphRecord:
    """One non-empty paragraph, in reading order. `text` is the clean source text
    and is never rewritten downstream."""
    sequence_order: int
    paragraph_id: str
    text: str
    breadcrumbs: list[str]
    page_number: int
    source_paragraph_index: int
    segment_index: int
    bucket: str
    container: str
    table_position: dict | None
    clause_id: str | None
    is_clause_start: bool
    numbering_source: str | None
    confidence: float | None
    flags: list[str]


@dataclass
class ParseResult:
    status: str
    document_name: str
    extracted_at: str
    schema_version: str = SCHEMA_VERSION
    document_title: str | None = None
    rejection: dict | None = None
    warnings: list[dict] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    clauses: list[dict] = field(default_factory=list)
    paragraphs: list[ParagraphRecord] = field(default_factory=list)
    source: dict | None = None
    timings_ms: dict = field(default_factory=dict)

    @property
    def is_usable(self):
        return self.status in (EXTRACTED, EXTRACTED_WITH_WARNINGS)

    def to_dict(self):
        return asdict(self)
