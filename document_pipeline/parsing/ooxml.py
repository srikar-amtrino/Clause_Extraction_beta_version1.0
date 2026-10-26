"""WordprocessingML namespaces, attribute helpers and a hardened XML parser."""
from lxml import etree

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}
W = "{%s}" % NS["w"]
MC = "{%s}" % NS["mc"]

# Values of an on/off property that mean "off" (w:val="0" and friends).
FALSE_VALUES = {"0", "false", "off"}


def parse_xml(data):
    """Parse untrusted XML bytes: no entity expansion, no DTD, no network."""
    parser = etree.XMLParser(
        resolve_entities=False,
        load_dtd=False,
        no_network=True,
        huge_tree=False,
    )
    return etree.fromstring(data, parser=parser)


def ln(el):
    """Local tag name of an element, or None for comments and processing instructions."""
    if not isinstance(el.tag, str):
        return None
    return etree.QName(el).localname


def wv(el, attr="val"):
    """Read a w:-namespaced attribute, tolerating a missing element."""
    return el.get(W + attr) if el is not None else None


def is_on(el):
    """An OOXML on/off property: present and not explicitly switched off."""
    return el is not None and (wv(el) or "").lower() not in FALSE_VALUES
