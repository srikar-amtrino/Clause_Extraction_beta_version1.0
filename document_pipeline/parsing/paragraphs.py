"""Clause tree to ordered paragraph records.

Every non-empty paragraph becomes exactly one record, whatever its bucket, so
nothing is dropped silently and later stages decide what to show.

Breadcrumbs are the owning clause's ancestors plus itself, one step each, using
the document's own display numbers: ["2. Definitions", "2.1"]. A step carries a
label only when the clause names itself, checked in this order:

1. a colon lead-in title             'Security: Supplier complies...'
2. a paragraph that is only a title  'Changes to Specifications.'
3. a run-in title before the body    'API License Grant. Subject to...'
4. a leading run of capitals         'RESTRICTIONS Customer shall not...'

Body text is never dragged into the trail. A clause with neither number nor
label falls back to a structural label or a short opening, so no step is empty.
"""
import re

from .result import ParagraphRecord
from .segmentation import CONTENT, TABLE
from .tree import MINOR_WORDS

_SOURCE_LABELS = {"front_matter": "FRONT MATTER", "form_line": "FORM LINES"}
_TITLE_MAX_CHARS = 80
_TITLE_MAX_WORDS = 12
_RUN_IN_MAX_WORDS = 8
_OPENING_MAX_CHARS = 48
_SENTENCE_BREAK = re.compile(r"[.!?;]\s+\S")
_RUN_IN_TITLE = re.compile(r"^([^.:;\n]{1,%d})[.:]\s+\S" % _TITLE_MAX_CHARS)


def _title_cased(phrase, max_words):
    """Upper case, or at least three quarters of its non-minor words capitalised."""
    words = phrase.split()
    if not words or len(words) > max_words:
        return False
    if phrase.isupper():
        return True
    voting = [w for w in words if w[:1].isalpha() and w.lower() not in MINOR_WORDS]
    return bool(voting) and sum(1 for w in voting if w[:1].isupper()) / len(voting) >= 0.75


def _whole_title(text):
    if len(text) > _TITLE_MAX_CHARS or _SENTENCE_BREAK.search(text) or text.endswith((";", ",")):
        return None
    title = text.rstrip(" .:")
    return title if _title_cased(title, _TITLE_MAX_WORDS) else None


def _run_in_title(text):
    m = _RUN_IN_TITLE.match(text)
    if not m:
        return None
    title = m.group(1).strip()
    return title if _title_cased(title, _RUN_IN_MAX_WORDS) else None


def _leading_capitals(text):
    """A run of capitalised words that is not simply the subject of a sentence:
    the word after it must not be lower case ('EDITED owns...' is a sentence)."""
    words = text.split()
    caps = []
    for w in words[:8]:
        letters = [c for c in w if c.isalpha()]
        if letters and all(c.isupper() for c in letters):
            caps.append(w)
        else:
            break
    label = " ".join(caps).rstrip(".,:;")
    if len(label) < 3:
        return None
    following = words[len(caps)] if len(caps) < len(words) else ""
    return None if following[:1].islower() else label


def breadcrumb_step(row):
    """One breadcrumb step for a clause row."""
    number = (row.get("display_number") or "").strip()
    text = (row.get("text") or "").strip()
    if row.get("numbering_source") == "form_line":
        return _SOURCE_LABELS["form_line"]
    label = (row.get("clause_title") or "").strip() or (
        text and (_whole_title(text) or _run_in_title(text) or _leading_capitals(text)))
    if not label and not number:
        label = _SOURCE_LABELS.get(row.get("numbering_source"))
        if not label and text:
            head = text.split(".")[0].strip() or text
            label = head[:_OPENING_MAX_CHARS].rstrip() + ("..." if len(head) > _OPENING_MAX_CHARS else "")
    return " ".join(part for part in (number, label) if part)


def breadcrumbs_for(clause_id, clauses_by_id):
    row = clauses_by_id.get(clause_id)
    if row is None:
        return []
    chain = [clauses_by_id[a] for a in row["ancestor_ids"] if a in clauses_by_id] + [row]
    return [step for step in (breadcrumb_step(r) for r in chain) if step]


def build_paragraph_records(records, clauses):
    """-> ordered ParagraphRecord list covering every non-empty record."""
    by_id = {c["clause_id"]: c for c in clauses}
    out = []
    for r in records:
        if not r["text"]:
            continue
        clause_id = r.get("clause_id") if r["bucket"] in (CONTENT, TABLE) else None
        starts = clause_id is not None and r["bucket"] == CONTENT and r.get("role") == "node"
        clause = by_id.get(clause_id) if starts else None
        seq = len(out) + 1
        out.append(ParagraphRecord(
            sequence_order=seq,
            paragraph_id="P-%03d" % seq,
            text=r["text"],
            breadcrumbs=breadcrumbs_for(clause_id, by_id),
            page_number=r["page"],
            source_paragraph_index=r["i"],
            segment_index=r.get("seg", 0),
            bucket=r["bucket"],
            container=r["kind"],
            table_position=dict(r["ctx"]) if r["ctx"] else None,
            clause_id=clause_id,
            is_clause_start=starts,
            numbering_source=clause["numbering_source"] if clause else None,
            confidence=clause["confidence"] if clause else None,
            flags=list(clause["flags"]) if clause else [],
        ))
    return out
