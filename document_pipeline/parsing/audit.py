"""Checking the work.

Per clause flags: numbering_conflict, low_confidence, inferred_parent,
heading_by_format, empty_text, depth_adjusted, depth_jump, sequence_gap.

Per document warnings: text_outside_any_clause, zero_clauses, no_text,
most_content_removed, flat_hierarchy, mojibake_suspected, high_conflict_rate.

Paragraph accounting must balance; if it does not, the document fails.
"""
import re

from . import switches
from .segmentation import CONTENT, INTRO_REMOVED, TOC
from .tree import ROOT_ID

MOJIBAKE = ("Ã", "â€", "�", "Â ")

# Sources whose confidence records how a clause was detected, not doubt about
# where it belongs. Flagging these would bury the clauses worth a second look.
STRUCTURAL_SOURCES = {
    "colon_lead_in", "inline_split", "front_matter", "heading_by_format", "inferred_parent",
}

_TAIL_NUMBER = re.compile(r"(?:\d+\.)*(\d+)")


def _tail_number(node):
    """Trailing integer of a clause number: '2.1' -> 1, '(iv)' -> None."""
    s = (node.get("canonical_path") or node.get("display_number") or "").strip().strip(". ()")
    m = _TAIL_NUMBER.fullmatch(s or "")
    return int(m.group(1)) if m else None


def flag_clauses(root):
    """Mark clauses whose structure looks doubtful."""

    def walk(node):
        prev = None
        for c in node["children"]:
            f = []
            if c.get("conflict"):
                f.append("numbering_conflict")
            if (c.get("confidence") or 0) < 0.75 and c.get("numbering_source") not in STRUCTURAL_SOURCES:
                f.append("low_confidence")
            if c.get("numbering_source") == "inferred_parent":
                f.append("inferred_parent")
            elif c.get("numbering_source") == "heading_by_format":
                f.append("heading_by_format")
            elif not (c.get("text") or "").strip():
                f.append("empty_text")
            if c["assigned_depth"] != c["level"] - 1:
                f.append("depth_adjusted")
            if node["id"] != ROOT_ID and c["assigned_depth"] > node["assigned_depth"] + 1:
                f.append("depth_jump")
            # a numbered sibling that is not the successor of the one before it
            cur = _tail_number(c)
            if prev is not None and cur is not None and cur != prev + 1:
                f.append("sequence_gap")
            if cur is not None:
                prev = cur
            c["flags"] = f if switches.EMIT_FLAGS else []
            walk(c)

    walk(root)


def audit(records, buckets, coverage):
    """Paragraph accounting. -> (ok, problems)"""
    problems = []
    total = len(records)
    if sum(buckets.values()) != total:
        problems.append("buckets sum to %d but there are %d paragraphs" % (sum(buckets.values()), total))
    if coverage["assigned"] != coverage["content"]:
        problems.append("%d of %d content paragraphs placed" % (coverage["assigned"], coverage["content"]))
    return (not problems), problems


def assess(records, buckets, clause_count, max_level, orphan_text=0):
    """Document-level warnings. An empty list means a clean extraction."""
    warnings = []

    if orphan_text:
        warnings.append({"code": "text_outside_any_clause",
                         "detail": "%d paragraphs were placed against the document root" % orphan_text})
    content = buckets.get(CONTENT, 0)
    non_empty = sum(1 for r in records if r["text"])

    if clause_count == 0:
        warnings.append({"code": "zero_clauses", "detail": "no clauses were detected in this document"})
    if non_empty == 0:
        warnings.append({"code": "no_text", "detail": "document contains no readable paragraph text"})
    removed = buckets.get(INTRO_REMOVED, 0) + buckets.get(TOC, 0)
    if non_empty and removed / non_empty > 0.5:
        warnings.append({"code": "most_content_removed",
                         "detail": "%d of %d paragraphs were removed as front matter or contents "
                                   "- clause detection probably failed" % (removed, non_empty)})
    if clause_count and max_level <= 1 and content > 30:
        warnings.append({"code": "flat_hierarchy",
                         "detail": "every clause landed at level 1 across %d paragraphs" % content})

    all_text = " ".join(r["text"] for r in records if r["text"])
    hits = sum(all_text.count(m) for m in MOJIBAKE)
    if hits > 5 and all_text and hits / len(all_text) > 0.001:
        warnings.append({"code": "mojibake_suspected", "detail": "%d encoding-artefact sequences found" % hits})

    conflicts = sum(1 for r in records if r.get("conflict"))
    if clause_count and conflicts / clause_count > 0.10:
        warnings.append({"code": "high_conflict_rate",
                         "detail": "%d of %d clauses disagree between Word and typed numbering"
                                   % (conflicts, clause_count)})
    return warnings
