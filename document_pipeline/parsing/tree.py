"""Working out depth, then nesting.

Signals, reconciled in this order:
1. Word numbering wins. Confidence 1.0, or 0.6 where the typed number visibly
   disagrees with it.
2. Outline level, for a heading with no numbering. Confidence 0.95.
3. Typed numbering, always placed below the Word-numbered clause it sits in so
   it can never outrank a real clause. Confidence 0.75.
4. A short title-cased lead-in closed by a colon. Confidence 0.7.
Anything else continues the clause above it.

A numbered list belongs under the heading in force; if it resumes under a
different heading its base is recalculated. A clause numbered 2.1 declares its
parent, clause 2: an unnumbered heading matching this document's own heading
formatting is promoted into that slot, otherwise an empty placeholder parent is
created. Either way it is marked.

Every content and table record is stamped with `clause_id`, the node it became
or was attached to (None when it sits against the document root).
"""
import re

from . import switches
from .counters import Counters
from .records import format_signature
from .segmentation import CONTENT, TABLE
from .typed_numbering import LexicalDepth

ROOT_ID = "root"

_VERBISH = {
    "shall", "will", "may", "must", "should", "can", "agrees", "agree",
    "includes", "include", "means", "excludes", "exclude", "provides",
    "provide", "is", "are", "was", "were", "has", "have", "had", "does",
    "do", "did", "be", "been", "being", "applies", "apply", "covers",
    "cover", "follows", "follow", "consists", "consist", "requires",
    "require", "sets", "set", "states", "state",
}

# Title case leaves these lower case, so they must not count against the vote.
MINOR_WORDS = {
    "of", "for", "and", "or", "the", "a", "an", "in", "on", "to", "with",
    "by", "at", "from", "as", "per", "nor", "but", "via", "vs",
}

_LEADERS = {
    "the", "a", "an", "if", "in", "on", "at", "to", "for", "of", "by",
    "with", "from", "upon", "where", "when", "while", "unless", "until",
    "except", "subject", "notwithstanding", "provided", "any", "all",
    "each", "every", "neither", "either", "both", "this", "that", "these",
    "those", "such", "no", "not", "as", "per", "without", "during",
}

_DOTTED_NUMBER = re.compile(r"\d+(?:\.\d+)*")


def title_lead_in(text):
    """-> (title, rest) when the text opens with a short title-cased phrase closed
    by a colon, otherwise (None, text).

    'Security: Whatfix complies with...'      -> ('Security', 'Whatfix ...')
    'The service excludes the following: tax' -> (None, unchanged)
    """
    if not text:
        return None, text
    s = text.lstrip()
    cut = s.find(":")
    if cut < 1 or cut > switches.TITLE_MAX_CHARS:
        return None, text

    title = s[:cut].strip()
    words = title.split()
    if not words or len(words) > switches.TITLE_MAX_WORDS:
        return None, text

    low = [w.strip(".,()[]").lower() for w in words]
    if low[0] in _LEADERS:
        return None, text
    if any(w in _VERBISH for w in low):
        return None, text

    if not title.isupper():
        voting = [w for w, lw in zip(words, low) if w[:1].isalpha() and lw not in MINOR_WORDS]
        if not voting:
            return None, text
        capped = sum(1 for w in voting if w[:1].isupper())
        if capped / len(voting) < 0.75:
            return None, text
    elif not any(w[:1].isalpha() for w in words):
        return None, text

    return title, s[cut + 1:].strip()


def is_colon_subclause(text):
    """True when an unnumbered paragraph should become a sub-clause of its own."""
    if not switches.DETECT_COLON_TITLES:
        return False
    title, _rest = title_lead_in(text)
    return title is not None


def _assign_roles(records, numbering):
    """Decide node/continuation, depth, display number and source for every
    content record."""
    ctr, lexer = Counters(numbering), LexicalDepth()
    heading_depth = -1
    colon_parent = None   # depth of the clause colon lead-ins nest under
    front_open = False    # a preamble node has been opened
    open_depth = None     # depth of the most recent clause of any kind
    anchor_depth = None   # depth of the most recent Word-numbered clause
    base_pinned = {}
    seen_under = {}       # numId -> heading generation when last used
    heading_seq = 0       # increments on every heading, marking a new region
    xml_anywhere = any(r["xml_ok"] for r in records if r["bucket"] == CONTENT)

    for r in records:
        if r["bucket"] != CONTENT:
            continue

        # 0a. Substantive front matter carries no number; the first such
        #     paragraph opens a preamble node, the rest are its body. It does
        #     not set open_depth, so it never parents the first real section.
        if r.get("front_matter"):
            if front_open:
                r["role"] = "continuation"
                continue
            front_open = True
            r.update(role="node", depth=0, display=None, path=None,
                     src="front_matter", conf=0.6, conflict=False)
            colon_parent = 0
            continue

        # 0b. A piece calved off a merged paragraph ranks as a peer of the
        #     clause in force rather than opening a level.
        if r.get("seg"):
            d = open_depth if open_depth is not None else max(heading_depth + 1, 0)
            r.update(role="node", depth=d,
                     display=(r["lex"]["display"] if r["lex"] else None),
                     path=None, src="inline_split", conf=0.7, conflict=False)
            open_depth = colon_parent = d
            continue

        # 1. Word numbering
        if r["xml_ok"]:
            lexer.reset()
            disp, path = ctr.advance(r["numId"], r["ilvl"])
            key = str(r["numId"])
            if key not in base_pinned:
                # a list first seen inside an open clause is a sub-list of it
                nest = (open_depth + 1) if open_depth is not None else 0
                base_pinned[key] = max(heading_depth + 1, nest, 0)
                seen_under[key] = heading_seq
            elif switches.RECOMPUTE_NUMBERING_BASE and seen_under.get(key) != heading_seq:
                # the list resumed under a different heading
                base_pinned[key] = max(heading_depth + 1, 0)
                seen_under[key] = heading_seq
            conflict = bool(r["lex"] and r["lex"]["display"] and disp
                            and r["lex"]["display"].strip(".() ") != disp.strip(".() "))
            r.update(role="node", depth=base_pinned[key] + r["ilvl"],
                     display=disp, path=path,
                     src="word_numbering:" + (r["num_src"] or "?"),
                     conf=0.6 if conflict else 1.0, conflict=conflict)
            open_depth = anchor_depth = colon_parent = r["depth"]
            continue

        # 2. Outline heading carrying no numbering
        if r["outline"] is not None:
            lexer.reset()
            heading_depth = r["outline"]
            heading_seq += 1
            r.update(role="node", depth=r["outline"], display=None, path=None,
                     src="outline_level", conf=0.95, conflict=False)
            open_depth = anchor_depth = colon_parent = r["depth"]
            continue

        # 3. Typed numbering, always below the clause it appears inside
        if r["lex"] and switches.LEXICAL_CONTEXT_STACK:
            rel = lexer.depth_for(r["lex"], r["band"], xml_active=xml_anywhere)
            if rel is not None:
                floor = (anchor_depth + 1) if anchor_depth is not None else max(heading_depth + 1, 0)
                r.update(role="node", depth=floor + rel,
                         display=r["lex"]["display"], path=None,
                         src="typed_numbering", conf=0.75, conflict=False)
                open_depth = colon_parent = r["depth"]
                continue

        # 4. Unnumbered paragraph opening with a short title and a colon
        if switches.DETECT_COLON_TITLES and is_colon_subclause(r["text"]):
            base = colon_parent if colon_parent is not None else max(heading_depth + 1, 0) - 1
            r.update(role="node", depth=base + 1, display=None, path=None,
                     src="colon_lead_in", conf=0.7, conflict=False)
            open_depth = r["depth"]
            continue

        # 5. Continuation of the clause above
        r["role"] = "continuation"


def _promote_matching_headings(records):
    """Fill a missing parent slot with an unnumbered heading whose formatting
    matches the headings this document already numbers. -> promoted count"""
    if not (switches.PROMOTE_MATCHING_HEADINGS and switches.REPAIR_SKIPPED_ANCESTORS):
        return 0
    content = [r for r in records if r["bucket"] == CONTENT]
    nodes = [r for r in content if r.get("role") == "node"]
    if not nodes:
        return 0

    top = min(r["depth"] for r in nodes)
    sigs = {format_signature(r) for r in nodes if r["depth"] == top}
    sigs.discard(None)

    numbered = set()
    for r in nodes:
        n = (r.get("path") or r.get("display") or "").strip().strip(". ()")
        if n:
            numbered.add(n)

    promoted = 0
    for idx, r in enumerate(content):
        if r.get("role") != "node":
            continue
        num = (r.get("path") or r.get("display") or "").strip().strip(". ()")
        if not num or "." not in num:
            continue
        want = num.rsplit(".", 1)[0]
        if want in numbered:
            continue
        prev = content[idx - 1] if idx else None
        if prev is None or prev.get("role") != "continuation":
            continue
        if format_signature(prev) not in sigs:
            continue
        prev.update(role="node", depth=top, display=want, path=want,
                    src="heading_by_format", conf=0.7, conflict=False)
        numbered.add(want)
        promoted += 1
    return promoted


def _empty_node(node_id, depth):
    return {"id": node_id, "display_number": None, "clause_title": None,
            "is_compound_lead_in": False, "lead_in_child_ids": [], "bonded_to_lead_in": None,
            "canonical_path": None, "assigned_depth": depth,
            "numbering_source": None, "confidence": None, "conflict": False, "style": None,
            "text": "", "body_paragraphs": [], "body_paragraph_ids": [],
            "table_cells": [], "children": [], "_pi": None}


def _new_node(r, nid):
    txt = (r["lex"]["rest"]
           if (r.get("src") in ("typed_numbering", "inline_split") and r["lex"])
           else r["text"])
    node = _empty_node("c%d" % nid, r["depth"])
    node.update(display_number=r.get("display"), clause_title=title_lead_in(txt)[0],
                canonical_path=r.get("path"), numbering_source=r.get("src"),
                confidence=r.get("conf"), conflict=r.get("conflict", False),
                style=r["style"], text=txt, _pi=r["i"])
    return node


def _placeholder(number, depth, nid):
    """A parent the document never wrote as its own paragraph."""
    node = _empty_node("c%di" % nid, depth)
    node.update(display_number=number, canonical_path=number,
                numbering_source="inferred_parent", confidence=0.5)
    return node


def _number_of(node):
    """The clause's own dotted number, e.g. '2.1', or None."""
    s = (node.get("canonical_path") or node.get("display_number") or "").strip().strip(".")
    return s if _DOTTED_NUMBER.fullmatch(s or "") else None


def _declared_parent(node):
    """The parent a dotted number names: '2.1' -> '2'. None if it names none."""
    n = _number_of(node)
    if not n or "." not in n:
        return None
    return n.rsplit(".", 1)[0]


def _mark_compound(node):
    """A clause whose text ends in a colon is a lead-in: its rule is incomplete
    without the items beneath it. The items are flagged as bonded rather than
    merged, so per-item traceability is kept."""
    for c in node["children"]:
        tail = c["body_paragraphs"][-1] if c["body_paragraphs"] else c.get("text") or ""
        if tail.rstrip().endswith(":") and c["children"]:
            c["is_compound_lead_in"] = True
            c["lead_in_child_ids"] = [k["id"] for k in c["children"]]
            for k in c["children"]:
                k["bonded_to_lead_in"] = c["id"]
        _mark_compound(c)


def build_tree(records, numbering):
    """Assign depths and build the clause tree. -> (root, coverage). All state is local."""
    _assign_roles(records, numbering)
    promoted = _promote_matching_headings(records)

    root = {"id": ROOT_ID, "assigned_depth": -1, "children": [],
            "body_paragraphs": [], "body_paragraph_ids": [], "table_cells": []}
    stack, nid, last, assigned, inferred = [], 0, None, 0, 0

    for r in records:
        b = r["bucket"]
        if b == CONTENT and r.get("role") == "node":
            n = _new_node(r, nid)
            nid += 1
            assigned += 1

            # A dotted number states its own parent. Honour that over position,
            # and create the parent when the document never wrote it. A split
            # piece's depth is already settled by the peer rule.
            want = (_declared_parent(n)
                    if switches.REPAIR_SKIPPED_ANCESTORS and n["numbering_source"] != "inline_split"
                    else None)
            if want:
                at = next((k for k, e in enumerate(stack) if _number_of(e) == want), None)
                if at is not None:
                    del stack[at + 1:]
                else:
                    d = max(n["assigned_depth"] - 1, 0)
                    while stack and stack[-1]["assigned_depth"] >= d:
                        stack.pop()
                    ph = _placeholder(want, d, nid)
                    nid += 1
                    inferred += 1
                    (stack[-1]["children"] if stack else root["children"]).append(ph)
                    stack.append(ph)

            while stack and stack[-1]["assigned_depth"] >= n["assigned_depth"]:
                stack.pop()
            (stack[-1]["children"] if stack else root["children"]).append(n)
            stack.append(n)
            last = n
            r["clause_id"] = n["id"]
        elif b == CONTENT and r.get("role") == "continuation":
            tgt = last or root
            tgt["body_paragraphs"].append(r["text"])
            tgt["body_paragraph_ids"].append(r["i"])
            assigned += 1
            r["clause_id"] = None if tgt is root else tgt["id"]
        elif b == TABLE:
            # kept with coordinates, attached to the clause it sits under
            tgt = last or root
            ctx = r["ctx"] or {}
            tgt["table_cells"].append({"paragraph_id": r["i"], "table": ctx.get("table"),
                                       "row": ctx.get("row"), "col": ctx.get("col"),
                                       "text": r["text"]})
            r["clause_id"] = None if tgt is root else tgt["id"]

    _mark_compound(root)

    content = sum(1 for r in records if r["bucket"] == CONTENT)
    return root, {"assigned": assigned, "content": content, "node_count": nid,
                  "inferred_parents": inferred, "promoted_headings": promoted}
