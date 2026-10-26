"""Page numbers, estimated.

A .docx does not store pagination; only a renderer knows where pages end. Two
signals are available, and they are never mixed because Word often writes both
at the same point, which would count one page turn twice:

- rendered: `w:lastRenderedPageBreak`, written by Word where each page began the
  last time it laid the document out. Used whenever the file carries any.
- explicit: `w:br w:type="page"`, `w:pageBreakBefore` (direct or via style) and
  section breaks that start a new page. Used otherwise; soft page turns caused
  by text flow are invisible to it, so later pages are undercounted.

`page_number` is the page a paragraph starts on. Cells of one table row start
on the same page and the row ends on the furthest page any cell reached.
Textbox paragraphs take the page of the paragraph that anchors them.
"""
from . import switches
from .ooxml import W, is_on, ln, wv
from .text import alternate_choice, is_hidden

RENDERED = "rendered"
EXPLICIT = "explicit"

_REMOVED = {"del", "moveFrom"}
_NON_PAGE_SECTION_TYPES = {"continuous", "nextColumn"}


def _page_events(p, rendered):
    """(breaks before any text, breaks after text) inside one paragraph."""
    before = after = 0
    seen_text = False

    def walk(el):
        nonlocal before, after, seen_text
        for c in el:
            t = ln(c)
            if t is None or t == "txbxContent":
                continue
            if t == "AlternateContent":
                ch = alternate_choice(c)
                if ch is not None:
                    walk(ch)
                continue
            if t in _REMOVED and switches.ACCEPT_TRACKED:
                continue
            if t == "r" and switches.SKIP_HIDDEN and is_hidden(c):
                continue
            if t == "t" and (c.text or "").strip():
                seen_text = True
            elif (rendered and t == "lastRenderedPageBreak") or (
                    not rendered and t == "br" and wv(c, "type") == "page"):
                if seen_text:
                    after += 1
                else:
                    before += 1
            walk(c)

    walk(p)
    return before, after


def _page_break_before(p, styles):
    el = p.find(W + "pPr/" + W + "pageBreakBefore")
    if el is not None:
        return is_on(el)
    return styles.page_break_before(wv(p.find(W + "pPr/" + W + "pStyle")))


def _section_starts_new_page(p):
    sect = p.find(W + "pPr/" + W + "sectPr")
    if sect is None:
        return False
    kind = wv(sect.find(W + "type")) or "nextPage"
    return kind not in _NON_PAGE_SECTION_TYPES


def estimate_pages(raw_paras, styles):
    """-> (start page per paragraph, page source)."""
    rendered = any(
        next(p.iter(W + "lastRenderedPageBreak"), None) is not None for p, _kind, _ctx in raw_paras
    )
    source = RENDERED if rendered else EXPLICIT

    pages = []
    page = 1                 # furthest page reached so far
    anchor_page = 1          # start page of the last non-textbox paragraph
    pending_section = False
    rows = {}                # (table, row) -> {"base": page, "cols": {col: page}}

    for idx, (p, kind, ctx) in enumerate(raw_paras):
        if kind == "textbox":
            pages.append(anchor_page)
            continue

        if ctx is not None:
            row = rows.setdefault((ctx["table"], ctx["row"]), {"base": page, "cols": {}})
            current = row["cols"].get(ctx["col"], row["base"])
        else:
            current = page

        before, after = _page_events(p, rendered)
        if not rendered:
            if pending_section:
                before += 1
                pending_section = False
            if idx and _page_break_before(p, styles):
                before += 1
            pending_section = _section_starts_new_page(p)

        start = current + before
        end = start + after
        if ctx is not None:
            row["cols"][ctx["col"]] = end
        page = max(page, end)
        anchor_page = start
        pages.append(start)

    return pages, source
