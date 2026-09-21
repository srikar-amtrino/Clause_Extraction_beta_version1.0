"""Numbering typed by hand.

For documents where the numbering is plain text on the page. A stack of open
numbering styles decides depth: a style already on the stack means a return to
that level, a new style opens a new one. No depth ceiling, and (a) differs from
(A) because case and bracket are part of the signature.

Two guards: (i)/(v)/(x) continue an open letter list when they are its next
item, otherwise they open a roman list; and a level only opens on 1, a or i, so
a lone "(ii) above will not apply..." stays out of the tree.
"""
import re

from . import switches

AMBIG = {"i", "v", "x"}

# A number followed by one of these is a cross-reference that wrapped onto a new
# line ("...Clauses 22.3,\n22.4 and 22.5 shall apply"), not a clause starting.
_CONNECTIVES = {"and", "or", "of", "through", "above", "below", "hereof", "herein", "hereunder"}
ROMAN_TOK = re.compile(r"^(?:x{0,3})(?:ix|iv|v?i{0,3})$")

LEX_PATTERNS = [
    ("dotted", re.compile(r"^\s*(\d+(?:\.\d+)+)\.?"
                          r"(?:[\s ]+|(?=[“”\"‘’'(]))")),
    ("section", re.compile(r"^\s*(?:SECTION|Section|ARTICLE|Article|CLAUSE|Clause)\s+"
                           r"((?:[0-9]+(?:\.[0-9]+)*|[IVXLC]+)"
                           r"(?:\([A-Za-z0-9]{1,3}\))?)"
                           r"\.?\s*[-–—:]?\s*")),
    ("num_dot", re.compile(r"^\s*(\d{1,3})[.)][\s ]+")),
    ("paren", re.compile(r"^\s*\(([A-Za-z]{1,4}|\d{1,3})\)[\s ]*")),
    # "II." "iv)" -- one letter (I. V. X.) is left to alpha_dot, which marks it ambiguous
    ("roman_dot", re.compile(r"^\s*([IVX]{2,6}|[ivx]{2,6})[.)][\s ]+")),
    ("alpha_dot", re.compile(r"^\s*([A-Za-z])[.)][\s ]+")),
]

# Indents closer than this (twips) belong to the same band.
_BAND_GAP = 150
_BAND_TOLERANCE = 75


def lex_detect(text):
    """Detect a typed number at the start of a paragraph."""
    for kind, rx in LEX_PATTERNS:
        m = rx.match(text)
        if not m:
            continue
        tok = m.group(1)
        if kind == "roman_dot" and not (switches.MULTI_LETTER_ROMAN and ROMAN_TOK.match(tok.lower())):
            continue
        if switches.REJECT_WRAPPED_REFERENCES:
            first = text[m.end():].split(None, 1)
            if first and first[0].rstrip(",;") in _CONNECTIVES:
                return None
        if kind == "dotted":
            cls, depth = "dotted", tok.count(".") + 1
        elif kind == "section":
            cls, depth = "section", 1
        else:
            low = tok.lower()
            if tok.isdigit():
                cls = "decimal"
            elif low in AMBIG:
                cls = "ambiguous"
            elif low and ROMAN_TOK.match(low):
                cls = "roman"
            else:
                cls = "alpha"
            depth = None
        disp = m.group(0).strip()
        return {"token": tok, "cls": cls, "depth": depth,
                "delim": "paren" if disp.startswith("(") else ("rparen" if disp.endswith(")") else "dot"),
                "case": "upper" if tok.isupper() else "lower",
                "display": disp, "rest": text[m.end():].strip()}
    return None


def _next_letter(tok):
    """Successor in an alphabetic sequence: a->b, z->aa."""
    if not tok:
        return "a"
    low, carry, out = tok.lower(), True, []
    for ch in reversed(low):
        if carry:
            if ch == "z":
                out.append("a")
            else:
                out.append(chr(ord(ch) + 1))
                carry = False
        else:
            out.append(ch)
    if carry:
        out.append("a")
    return "".join(reversed(out))


class LexicalDepth:
    """Stack of open typed-numbering styles. One instance per document."""

    def __init__(self):
        self.stack = []  # [{'sig': (cls, case, delim), 'last': token}]

    def reset(self):
        """Called when a heading or Word-numbered clause interrupts typed lists."""
        self.stack = []

    @staticmethod
    def _sig(lex):
        return (lex["cls"], lex["case"], lex["delim"])

    def resolve_ambiguous(self, lex):
        """Decide whether (i)/(v)/(x) continues a letter list or opens a roman one."""
        alpha_sig = ("alpha", lex["case"], lex["delim"])
        for e in self.stack:
            if e["sig"] == alpha_sig and _next_letter(e["last"]) == lex["token"].lower():
                return "alpha"
        return "roman"

    @staticmethod
    def _is_sequence_start(lex):
        """A list opens at 1, a, i, A or I; anything else continuing no open list
        is a cross reference inside prose."""
        return lex["token"].lower() in ("1", "a", "i")

    def depth_for(self, lex, band, xml_active=False):
        """Relative depth of this token, or None when it must not open a level."""
        if lex["cls"] == "ambiguous":
            lex["cls"] = self.resolve_ambiguous(lex)

        if lex["cls"] == "section":
            # 'Section 4(b)) for such party' is a cross reference, not a heading.
            # Only trust a Section token where the document has no Word numbering.
            if xml_active:
                return None
            self.stack = [{"sig": self._sig(lex), "last": lex["token"]}]
            return 0

        if lex["cls"] == "dotted":
            d = lex["token"].count(".")
            self.stack = self.stack[:d]
            while len(self.stack) < d:
                self.stack.append({"sig": ("filler", "", ""), "last": ""})
            self.stack.append({"sig": self._sig(lex), "last": lex["token"]})
            return d

        sig = self._sig(lex)
        at = next((k for k, e in enumerate(self.stack) if e["sig"] == sig), None)

        if at is not None:
            starts = self._is_sequence_start(lex)
            # same style, restarted, and visibly indented deeper -> a nested list
            if not (starts and band is not None and band > at):
                self.stack = self.stack[:at + 1]
                self.stack[at]["last"] = lex["token"]
                return at

        # Opening a brand-new level is only credible at the start of a sequence.
        if not self._is_sequence_start(lex):
            return None

        self.stack.append({"sig": sig, "last": lex["token"]})
        return len(self.stack) - 1


def apply_lexical(records):
    """Attach typed-number detection and an indent band to every record.

    Bands cluster the distinct indents present in this document, so they express
    relative nesting rather than absolute measurements."""
    inds, bands = sorted({r["indent"] for r in records if r["indent"] is not None}), []
    for v in inds:
        if not bands or v - bands[-1] > _BAND_GAP:
            bands.append(v)

    def band_of(v):
        if v is None or not bands:
            return 0
        return max(i for i, b in enumerate(bands) if v >= b - _BAND_TOLERANCE)

    for r in records:
        r["lex"] = lex_detect(r["text"]) if r["text"] else None
        r["band"] = band_of(r["indent"])
    return bands
