"""Step 2.2: one .docx in, one ParseResult out.

Never raises. Rejected, failed and garbled files still come back as a result
with a status and a reason:

- extracted / extracted_with_warnings: usable output
- rejected: not a .docx
- failed: a valid .docx that could not be parsed, or whose accounting did not
  balance; no partial output is returned
"""
import io
import logging
from collections import Counter

from .audit import assess, audit, flag_clauses
from .clauses import flatten
from .enrich import enrich
from .format_gate import NotADocxError, load_parts
from .inline_split import conservation_check, split_records
from .numbering import Numbering
from .ooxml import W, parse_xml
from .pages import estimate_pages
from .paragraphs import build_paragraph_records
from .records import build_records
from .result import EXTRACTED, EXTRACTED_WITH_WARNINGS, FAILED, REJECTED, ParseResult
from .segmentation import TABLE, segment
from .styles import Styles
from .tree import build_tree
from .typed_numbering import apply_lexical
from .walker import iter_paragraphs

logger = logging.getLogger(__name__)


def _failed(result, reason):
    result.status = FAILED
    result.rejection = {"reason": reason, "detected_format": "docx",
                        "detected_description": "valid .docx that could not be parsed",
                        "remedy": "valid .docx but extraction was unsafe - send to engineering"}
    return result


def extract_document(source, document_name):
    """Extract one .docx from bytes or a binary stream. Never raises."""
    stream = io.BytesIO(source) if isinstance(source, (bytes, bytearray)) else source
    result = ParseResult(status=FAILED, document_name=document_name)

    try:
        parts = load_parts(stream)
    except NotADocxError as exc:
        result.status = REJECTED
        result.rejection = {"reason": str(exc), "detected_format": exc.kind,
                            "detected_description": exc.human, "remedy": exc.remedy}
        return result

    try:
        return _extract(parts, result)
    except Exception as exc:
        logger.exception("extraction failed for %s", document_name)
        return _failed(result, "%s: %s" % (type(exc).__name__, exc))


def _extract(parts, result):
    styles = Styles(parts["styles"])
    numbering = Numbering(parts["numbering"], styles)
    body = parse_xml(parts["document"]).find(W + "body")
    if body is None:
        raise ValueError("document.xml contains no <w:body>")

    raw_paras = list(iter_paragraphs(body))
    pages, page_source = estimate_pages(raw_paras, styles)
    records = build_records(raw_paras, styles, numbering, pages)
    source_text = [r["text"] for r in records]
    source_paragraphs = len(records)

    records, inline_splits = split_records(records)
    conservation = conservation_check(source_text, records)
    if not conservation["balanced"]:
        return _failed(result, "text conservation failed: %d source characters became %d after splitting"
                       % (conservation["source_chars"], conservation["record_chars"]))

    apply_lexical(records)
    buckets, title = segment(records)
    root, coverage = build_tree(records, numbering)
    orphan_text = len(root["body_paragraphs"])
    clause_count = enrich(root)
    flag_clauses(root)

    ok, problems = audit(records, buckets, coverage)
    if not ok:
        return _failed(result, "paragraph accounting failed: " + "; ".join(problems))

    clauses = flatten(root)
    paragraphs = build_paragraph_records(records, clauses)
    expected = sum(1 for r in records if r["text"])
    if len(paragraphs) != expected:
        return _failed(result, "paragraph records cover %d of %d non-empty paragraphs"
                       % (len(paragraphs), expected))

    max_level = max((c["level"] for c in clauses), default=0)
    warnings = assess(records, buckets, clause_count, max_level, orphan_text)

    result.status = EXTRACTED_WITH_WARNINGS if warnings else EXTRACTED
    result.document_title = title
    result.warnings = warnings
    result.clauses = clauses
    result.paragraphs = paragraphs
    result.stats = {
        "clause_count": clause_count,
        "max_level": max_level,
        "clauses_by_level": {str(k): v for k, v in sorted(Counter(c["level"] for c in clauses).items())},
        "root_clauses": sum(1 for c in clauses if c["level"] == 1),
        "leaf_clauses": sum(1 for c in clauses if c["is_leaf"]),
        "paragraph_records": len(paragraphs),
        "paragraphs_total": len(records),
        "source_paragraphs": source_paragraphs,
        "inline_splits": inline_splits,
        "text_conserved": True,
        "source_chars": conservation["source_chars"],
        "orphan_paragraphs": orphan_text,
        "front_matter_kept": sum(1 for r in records if r.get("front_matter")),
        "compound_lead_ins": sum(1 for c in clauses if c["is_compound_lead_in"]),
        "paragraph_buckets": dict(buckets),
        "accounting_balanced": True,
        "table_cells": buckets.get(TABLE, 0),
        "inferred_parents": coverage["inferred_parents"],
        "promoted_headings": coverage["promoted_headings"],
        "conflicts": sum(1 for c in clauses if c["conflict"]),
        "flagged_clauses": sum(1 for c in clauses if c["flags"]),
        "has_numbering_xml": parts["numbering"] is not None,
        "numbering_sources": dict(Counter(c["numbering_source"] for c in clauses)),
        "page_count": max(pages, default=1),
        "page_source": page_source,
    }
    return result

