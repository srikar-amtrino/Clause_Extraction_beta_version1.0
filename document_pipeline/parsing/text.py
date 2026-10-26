"""Paragraph text.

Handles tracked changes, moved text, hyperlinks, smart tags, content controls,
fields and the compatibility wrappers newer Word versions add. Field
instruction codes are dropped on purpose: they are the machinery behind cross
references and tables of contents, not text anyone wrote. Textbox content is
skipped here and emitted by the walker instead, so it appears exactly once.
"""
import re

from . import switches
from .ooxml import MC, W, ln

# Inline wrappers whose children are ordinary paragraph content.
_TRANSPARENT = {"ins", "moveTo", "hyperlink", "smartTag", "sdt", "sdtContent", "fldSimple",
                "customXml", "dir", "bdo"}
# Inline wrappers holding content removed by a tracked change.
_REMOVED = {"del", "moveFrom"}
# Containers whose text belongs to another paragraph stream, or to no text at all.
_SKIPPED = {"txbxContent", "pict", "drawing", "object"}

_MULTI_SPACE = re.compile(r"[ \t]{2,}")


def is_hidden(run):
    """True when a run is marked hidden (w:vanish)."""
    rpr = run.find(W + "rPr")
    return rpr is not None and rpr.find(W + "vanish") is not None


def alternate_choice(el):
    """The branch of an mc:AlternateContent that is read: Choice, else Fallback."""
    ch = el.find(MC + "Choice")
    return ch if ch is not None else el.find(MC + "Fallback")


def para_text(p):
    """-> (clean, raw) text of a paragraph."""
    parts = []

    def walk(el):
        if el is None:
            return
        for c in el:
            t = ln(c)
            if t is None:
                continue
            if t == "AlternateContent":
                walk(alternate_choice(c))
                continue
            if t in _REMOVED:
                if not switches.ACCEPT_TRACKED:
                    walk(c)
                continue
            if t in _SKIPPED:
                continue
            if t == "r":
                if switches.SKIP_HIDDEN and is_hidden(c):
                    continue
                for rc in c:
                    rt = ln(rc)
                    if rt == "t":
                        parts.append(rc.text or "")
                    elif rt == "delText":
                        if not switches.ACCEPT_TRACKED:
                            parts.append(rc.text or "")
                    elif rt == "tab":
                        parts.append("\t")
                    elif rt in ("br", "cr"):
                        parts.append("\n")
                    elif rt == "noBreakHyphen":
                        parts.append("-")
                    elif rt == "sym":
                        parts.append(" ")
                    elif rt == "AlternateContent":
                        walk(alternate_choice(rc))
                continue
            if t in _TRANSPARENT:
                walk(c)

    walk(p)
    raw = "".join(parts)
    clean = _MULTI_SPACE.sub(" ", raw.replace("\t", " ").replace("\xa0", " "))
    return clean.strip(), raw
