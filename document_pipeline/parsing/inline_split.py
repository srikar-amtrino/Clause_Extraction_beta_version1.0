"""Two clauses on one line.

Authors often start the next clause on the same line instead of pressing Enter,
so one <w:p> can hold several clauses. Each paragraph is pre-scanned and split
into separate records before the tree is built. The risk is cutting a cross
reference in half, so three guards must agree before a cut is made.

`i` stays the index of the source paragraph, so every record still points at
the <w:p> it came from; `seg` orders the pieces within it.

Characters are built with chr() on purpose: curly quotes and non-breaking
spaces typed into a pattern get rewritten by editors and silently break it.
"""
import re

from . import switches

NBSP = chr(0xA0)
QUOTES = '"' + "'" + chr(0x201C) + chr(0x201D) + chr(0x2018) + chr(0x2019)
OPENERS = QUOTES + "("
_Q = re.escape(QUOTES)
_O = re.escape(OPENERS)
_SP = "[" + NBSP + r"\s]"

# A clause number may be followed by whitespace, or run straight into an
# opening quote or bracket: "1.10." then a defined term, with no space.
_AFTER_NUM = "(?:" + _SP + "+|(?=[" + _O + "]))"

# Identifiers that may open a clause mid-paragraph.
_STRONG = [
    ("dotted", re.compile(r"(?<![\w.])(\d{1,3}(?:\.\d{1,3})+)\.?" + _AFTER_NUM)),
    ("section", re.compile(r"(?<![\w.])((?:SECTION|Section|ARTICLE|Article"
                           r"|CLAUSE|Clause)" + _SP + r"+(?:\d{1,3}(?:\.\d{1,3})*"
                           r"|[IVXLC]{1,6})(?:\([A-Za-z0-9]{1,3}\))?)\.?" + _SP + "+")),
]
_WEAK = [
    ("num_dot", re.compile(r"(?<![\w.])(\d{1,3})[.)]" + _SP + "+")),
    ("paren", re.compile(r"(?<!\w)\(([A-Za-z]{1,3}|\d{1,3})\)" + _SP + "*")),
]

# A word immediately before the identifier that makes it a reference to
# somewhere else in the contract rather than the start of a new clause.
_REFERENCE_WORDS = {
    "under", "in", "of", "to", "per", "see", "with", "by", "and", "or", "at",
    "from", "into", "upon", "pursuant", "subject", "accordance", "provided",
    "set", "forth", "described", "referenced", "referred", "above", "below",
    "herein", "hereof", "thereof", "this", "that", "said", "such", "any",
    "section", "sections", "clause", "clauses", "article", "articles",
    "paragraph", "paragraphs", "exhibit", "schedule", "annex", "appendix",
    "than", "exceed", "exceeds", "least", "more", "less", "within",
}

_SENTENCE_END = re.compile(r"[.:;!?][" + _Q + r")\]]?" + _SP + "+$")
_PREV_WORD = re.compile(r"([A-Za-z]+)[" + _O + r"\[" + NBSP + r"\s]*$")
_QUOTED_TERM = re.compile("^[" + _Q + "]([^" + _Q + "]{1,60})[" + _Q + "]")
_TITLE_PHRASE = re.compile(r"([^.:\n]{1,80})[.:]")
_WS = re.compile(_SP + "+")


def _preceded_by_sentence_end(text, pos):
    """Guards 1 and 2. The identifier must open a sentence, and the word before
    that sentence break must not turn it into a cross reference."""
    before = text[:pos]
    if not before.strip():
        return False
    end = _SENTENCE_END.search(before)
    if not end:
        return False
    m = _PREV_WORD.search(before[:end.start() + 1])
    return not (m and m.group(1).lower() in _REFERENCE_WORDS)


def _has_anchor(rest):
    """Guard 3. What follows the identifier must look like a clause opening: a
    short quoted defined term, or a short title-cased or upper-cased phrase
    closed by a period or colon. Lower-case prose means it was a reference."""
    rest = rest.lstrip()
    if not rest:
        return False

    q = _QUOTED_TERM.match(rest)
    if q and len(q.group(1).split()) <= 6:
        return True

    m = _TITLE_PHRASE.match(rest)
    if not m:
        return False
    phrase = m.group(1).strip()
    words = phrase.split()
    if not words or len(words) > 8:
        return False
    if phrase.isupper():
        return True
    alpha = [w for w in words if w[:1].isalpha()]
    if not alpha:
        return False
    return sum(1 for w in alpha if w[:1].isupper()) / len(alpha) >= 0.75


def find_inline_boundaries(text):
    """Character offsets inside `text` where a further clause begins."""
    if not text or not switches.SPLIT_INLINE_CLAUSES:
        return []
    cuts = []
    for _kind, rx in _STRONG + (_WEAK if switches.SPLIT_WEAK_CLASSES else []):
        for m in rx.finditer(text):
            pos = m.start()
            if pos < switches.SPLIT_MIN_CHARS or len(text) - pos < switches.SPLIT_MIN_CHARS:
                continue
            if not _preceded_by_sentence_end(text, pos):
                continue
            if not _has_anchor(text[m.end():]):
                continue
            cuts.append(pos)
    return sorted(set(cuts))


def split_records(records):
    """Expand records whose text holds more than one clause. -> (records, splits)"""
    if not switches.SPLIT_INLINE_CLAUSES:
        for r in records:
            r["seg"], r["split_of"] = 0, None
        return records, 0

    out, splits = [], 0
    for r in records:
        cuts = find_inline_boundaries(r["text"])
        pieces = []
        if cuts:
            bounds = [0] + cuts + [len(r["text"])]
            pieces = [p for p in (r["text"][a:b].strip() for a, b in zip(bounds, bounds[1:])) if p]
        if len(pieces) < 2:
            r["seg"], r["split_of"] = 0, None
            out.append(r)
            continue

        splits += len(pieces) - 1
        for k, piece in enumerate(pieces):
            d = dict(r)
            d["text"], d["seg"], d["split_of"] = piece, k, r["i"]
            if k:
                # only the first piece keeps the paragraph's own Word numbering
                d["numId"] = d["ilvl"] = d["num_src"] = None
                d["xml_ok"] = False
            out.append(d)
    return out, splits


def conservation_check(source_text, records):
    """Prove no character was invented or lost while splitting: the
    whitespace-stripped source text must equal the same over the records."""
    src = _WS.sub("", "".join(source_text))
    got = _WS.sub("", "".join(r["text"] or "" for r in records))
    return {"source_chars": len(src), "record_chars": len(got), "balanced": src == got}
