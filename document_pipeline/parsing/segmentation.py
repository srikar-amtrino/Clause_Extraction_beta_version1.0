"""Sorting paragraphs into buckets.

Before any hierarchy is built, every paragraph lands in exactly one bucket:
empty, toc, table, document_title, intro_removed or content.

The body starts at the first paragraph carrying real Word numbering, a
structural test rather than a keyword one. With no Word numbering, the first
typed number is used. If neither turns up nothing is removed, so front matter
removal can never drop a whole document. Administrative front-matter lines are
dropped; substantive preamble text is kept and marked for the tree.
"""
import re
from collections import Counter

from . import switches

EMPTY = "empty"
TOC = "toc"
TABLE = "table"
DOCUMENT_TITLE = "document_title"
INTRO_REMOVED = "intro_removed"
CONTENT = "content"

TOC_STYLE = re.compile(r"^toc\s*\d*$", re.I)

_NOISE_HINTS = re.compile(
    r"^\s*(?:page\s*\d|\d+\s*of\s*\d|version\s|v\d+\.\d|confidential\b|draft\b"
    r"|private\s+and\s+confidential|copyright|\(c\)\s*\d{4}|all\s+rights)",
    re.I)

# Words that mark a front-matter paragraph as operative rather than decorative.
_SUBSTANTIVE = re.compile(
    r"\b(?:whereas|recital|recitals|background|witnesseth|now\s+therefore"
    r"|entered\s+into|is\s+made|agreement\s+is|between|by\s+and\s+between"
    r"|parties|party|effective\s+date|in\s+consideration)\b", re.I)


def _is_noise(text):
    """True for a front-matter line that carries no operative content."""
    t = (text or "").strip()
    if not t:
        return True
    if _NOISE_HINTS.match(t):
        return True
    # short, no sentence, and nothing operative in it
    if len(t) <= switches.NOISE_MAX_CHARS and not _SUBSTANTIVE.search(t):
        return "." not in t.rstrip(".")
    return False


def segment(records):
    """Assign a bucket to every record. -> (bucket counts, document title)"""
    for r in records:
        r["front_matter"] = False
        if not r["text"]:
            r["bucket"] = EMPTY
        elif switches.REMOVE_TOC and r["style"] and TOC_STYLE.match(r["style"]):
            r["bucket"] = TOC
        elif switches.ISOLATE_TABLES and r["kind"] == "table":
            r["bucket"] = TABLE
        else:
            r["bucket"] = CONTENT

    title = None
    if switches.REMOVE_FRONT_MATTER:
        live = [r for r in records if r["bucket"] == CONTENT]
        start = next((r["i"] for r in live if r["xml_ok"]), None)
        if start is None:
            start = next((r["i"] for r in live if r["lex"]), None)

        if start is not None:
            front = [r for r in live if r["i"] < start]
            heads = [r for r in front if r["outline"] == 0]
            if heads:
                title = " ".join(h["text"] for h in heads).strip()
            elif front:
                title = front[0]["text"]

            for r in front:
                if heads and r in heads:
                    r["bucket"] = DOCUMENT_TITLE
                elif not switches.KEEP_SUBSTANTIVE_FRONT_MATTER or _is_noise(r["text"]):
                    r["bucket"] = INTRO_REMOVED
                else:
                    # kept in the content stream, marked so the tree puts it in a
                    # preamble node rather than losing it against the root
                    r["front_matter"] = True

    return Counter(r["bucket"] for r in records), title
