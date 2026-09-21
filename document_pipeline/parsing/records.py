"""One record per paragraph.

Flattens each paragraph into the facts later stages need: style, numbering,
outline level, indent, text, container and page. Numbering written on the
paragraph beats numbering inherited from its style. A numId of 0 means
"deliberately not numbered", not "numbered zero".
"""
import re

from . import switches
from .ooxml import W, wv
from .text import para_text

_HEADING_STYLE = re.compile(r"^Heading[ ]?(\d+)$")

# Share of characters that must carry a trait for the paragraph to have it.
BOLD_CHAR_SHARE = 0.75


def p_style(p):
    return wv(p.find(W + "pPr/" + W + "pStyle"))


def p_numpr(p):
    """Numbering written directly on the paragraph -> (numId, ilvl) or None."""
    npr = p.find(W + "pPr/" + W + "numPr")
    if npr is None:
        return None
    nid = wv(npr.find(W + "numId"))
    il = wv(npr.find(W + "ilvl")) or "0"
    return (nid, int(il)) if nid is not None else None


def p_indent(p, sid, styles):
    """Effective left indent in twips: direct first, then style chain."""
    ind = p.find(W + "pPr/" + W + "ind")
    if ind is not None:
        for a in ("left", "start"):
            if ind.get(W + a) is not None:
                try:
                    return int(ind.get(W + a))
                except ValueError:
                    pass
    return styles.indent(sid)


def p_outline(p, sid, styles):
    """Effective outline level: direct, then HeadingN style name, then chain."""
    o = p.find(W + "pPr/" + W + "outlineLvl")
    if o is not None:
        lvl = int(wv(o))
    elif sid and _HEADING_STYLE.match(sid):
        lvl = int(_HEADING_STYLE.match(sid).group(1)) - 1
    else:
        lvl = styles.outline(sid)
    if lvl is not None and switches.TREAT_OUTLINE_9_AS_BODY and lvl >= 9:
        return None
    return lvl


def _trait_share(runs, tag):
    """Share of characters carrying a run property. Counted by characters, not
    runs: Word splits a heading across runs and often leaves a trailing period
    or bookmark unbolded."""
    total = marked = 0
    for txt, rpr in runs:
        n = len(txt.strip())
        total += n
        if rpr is not None and rpr.find(W + tag) is not None:
            marked += n
    return (marked / total) if total else 0.0


def _runs_of(rec):
    out = []
    for r in rec["el"].iter(W + "r"):
        txt = "".join(t.text or "" for t in r.findall(W + "t"))
        if txt.strip():
            out.append((txt, r.find(W + "rPr")))
    return out


def format_signature(rec):
    """A paragraph's visual identity, used to match unnumbered headings against
    the headings this same document already numbers. Compared exactly, so style
    and indent band are part of it."""
    runs = _runs_of(rec)
    if not runs:
        return None

    def has(tag):
        return _trait_share(runs, tag) >= BOLD_CHAR_SHARE

    return (has("b"), has("i"), has("caps"), has("smallCaps"), rec["style"], rec["band"])


def build_records(raw_paras, styles, numbering, pages):
    """One record per paragraph, with everything later stages need."""
    records = []
    for i, (p, kind, ctx) in enumerate(raw_paras):
        sid = p_style(p)
        clean, raw = para_text(p)
        direct = p_numpr(p)
        npr, src = direct, ("direct" if direct else None)
        if npr is None and sid:
            s = styles.numpr(sid)
            if s:
                npr, src = (s[0], s[1]), "style"
        if npr and str(npr[0]) == "0":
            npr, src = None, None

        num_id = npr[0] if npr else None
        ilvl = npr[1] if npr else None
        lvl = numbering.level(num_id, ilvl) if num_id is not None else None

        records.append({
            "i": i, "el": p, "kind": kind, "ctx": ctx, "style": sid,
            "text": clean, "raw": raw, "page": pages[i],
            "numId": num_id, "ilvl": ilvl, "num_src": src,
            # a bullet or an unnumbered level carries no hierarchy information
            "xml_ok": lvl is not None and lvl["numFmt"] not in ("bullet", "none"),
            "indent": p_indent(p, sid, styles),
            "outline": p_outline(p, sid, styles),
        })
    return records
