"""Build minimal .docx files in memory for tests."""
import io
import zipfile
from xml.sax.saxutils import escape

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '</Types>'
)

# Two-level legal numbering: "1." then "1.1".
DECIMAL_NUMBERING = (
    '<w:numbering xmlns:w="%s">'
    '<w:abstractNum w:abstractNumId="0">'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%%1."/></w:lvl>'
    '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%%1.%%2"/></w:lvl>'
    '</w:abstractNum>'
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    '</w:numbering>' % W_NS
)


def run(text="", *, bold=False, hidden=False, before="", after=""):
    """A run. `before` / `after` are raw run children placed around the text."""
    props = ("<w:b/>" if bold else "") + ("<w:vanish/>" if hidden else "")
    rpr = "<w:rPr>%s</w:rPr>" % props if props else ""
    t = '<w:t xml:space="preserve">%s</w:t>' % escape(text) if text else ""
    return "<w:r>%s%s%s%s</w:r>" % (rpr, before, t, after)


def para(*content, style=None, num=None, outline=None, page_break_before=False, section_break=None):
    """A paragraph. `content` items are run XML or plain text; `num` is (numId, ilvl)."""
    ppr = ""
    if style:
        ppr += '<w:pStyle w:val="%s"/>' % style
    if page_break_before:
        ppr += "<w:pageBreakBefore/>"
    if num:
        ppr += '<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%s"/></w:numPr>' % (num[1], num[0])
    if outline is not None:
        ppr += '<w:outlineLvl w:val="%d"/>' % outline
    if section_break:
        ppr += '<w:sectPr><w:type w:val="%s"/></w:sectPr>' % section_break
    body = "".join(c if c.startswith("<") else run(c) for c in content)
    return "<w:p>%s%s</w:p>" % ("<w:pPr>%s</w:pPr>" % ppr if ppr else "", body)


def table(rows):
    """A table from a list of rows, each a list of cell paragraph XML strings."""
    trs = "".join("<w:tr>%s</w:tr>" % "".join("<w:tc>%s</w:tc>" % cell for cell in row) for row in rows)
    return "<w:tbl>%s</w:tbl>" % trs


def make_docx(*blocks, numbering=None, styles=None):
    """-> .docx bytes whose body holds the given paragraph / table XML blocks."""
    document = '<w:document xmlns:w="%s"><w:body>%s</w:body></w:document>' % (W_NS, "".join(blocks))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("word/document.xml", document)
        if numbering:
            z.writestr("word/numbering.xml", numbering)
        if styles:
            z.writestr("word/styles.xml", styles)
    return buffer.getvalue()
