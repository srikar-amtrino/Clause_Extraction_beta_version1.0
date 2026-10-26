"""Walking the document.

Every paragraph in reading order, tagged with where it lives: body, table cell
or textbox. Table cells carry their table, row and column index so the content
keeps its position. Nested tables fall out of the recursion.
"""
from .ooxml import W, ln
from .text import alternate_choice


def iter_paragraphs(body):
    """Yield (paragraph, kind, ctx) for every paragraph, in document order."""
    seq = {"tbl": 0}

    def walk(el, kind, ctx):
        for c in el:
            t = ln(c)
            if t == "p":
                yield (c, kind, ctx)
                # textbox paragraphs are skipped by para_text, so emit them here
                for tb in c.iter(W + "txbxContent"):
                    for tp in tb.findall(W + "p"):
                        yield (tp, "textbox", ctx)
            elif t == "tbl":
                seq["tbl"] += 1
                ti = seq["tbl"]
                for ri, row in enumerate(c.findall(W + "tr")):
                    for ci, cell in enumerate(row.findall(W + "tc")):
                        yield from walk(cell, "table", {"table": ti, "row": ri, "col": ci})
            elif t == "sdt":
                sc = c.find(W + "sdtContent")
                if sc is not None:
                    yield from walk(sc, kind, ctx)
            elif t == "AlternateContent":
                ch = alternate_choice(c)
                if ch is not None:
                    yield from walk(ch, kind, ctx)
            elif t in ("sdtContent", "customXml", "smartTag"):
                yield from walk(c, kind, ctx)

    yield from walk(body, "body", None)
