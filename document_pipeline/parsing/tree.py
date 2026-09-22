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


# The quote characters a drafter may wrap a defined term in.
_QUOTES = "\"'‘’“”„‟«»"
# The verb that turns a quoted term into a definition. A quoted phrase followed
# by anything else is a quotation inside ordinary clause text.
#   "X" means ... / "X" and "Y" shall each have the meanings given ...
_DEFINING = (r"(?:(?:shall|will|is|are|has|have)\s+)?"
             r"(?:(?:each|respectively|also|collectively|both|together)\s+)?"
             r"(?:means?\b|have\s+the\s+meanings?\b|has\s+the\s+meanings?\b"
             r"|the\s+same\s+meanings?\b|defined\s+(?:as|in|below)\b"
             r"|refers?\s+to\b|refer\s+to\b|includes?\b|include\b)")


def _definition_pattern():
    quoted = "[%s][^%s]{1,%d}[%s]" % (_QUOTES, _QUOTES,
                                      switches.DEFINITION_TERM_MAX_CHARS, _QUOTES)
    return re.compile(
        r"^\s*(?P<term>" + quoted + r")"
        # further terms sharing one definition: "BOM" or "Bill of Materials"
        r"(?:\s*(?:,|;|,?\s*(?:and|or))\s*" + quoted + r")*"
        # an aside before the verb: "Term" (as used in Clause 3) means ...
        r"\s*(?:\([^)]{1,60}\)\s*)?"
        r"[,:\s]\s*" + _DEFINING,
        re.IGNORECASE)


_DEFINITION_ENTRY = _definition_pattern()


def definition_term(text):
    """-> the defined term when the text opens a definitions-list entry,
    otherwise None.

    '"Business Day" means a day other than a Saturday'   -> 'Business Day'
    '"BOM" or "Bill of Materials" shall have the meaning' -> 'BOM'
    'The Customer shall comply with the terms of the AUP' -> None
    """
    if not switches.DETECT_DEFINITION_TERMS or not text:
        return None
    match = _DEFINITION_ENTRY.match(text.lstrip())
    if match is None:
        return None
    return match.group("term").strip(_QUOTES + " ") or None


# a run of underscores or dots, or a [placeholder] / [[placeholder]]
_FORM_BLANK = re.compile(r"_{4,}|\.{6,}|\[\[?[^\]]{1,80}\]\]?")
# Words that only a signature block uses, and generic field labels that make a
# signature line only in pairs ("Title ___ Date ___"); "Beneficiary Name: [ ]"
# alone is a payment field, not a signature.
_SIGNING_WORDS = {
    "signature", "signatures", "signed", "sign", "printed", "print", "by", "witness",
    "witnesses", "seal", "signatory", "authorised", "authorized",
}
_FIELD_WORDS = {"name", "title", "date", "designation", "representative"}
_FORM_WORDS = _SIGNING_WORDS | _FIELD_WORDS
_EXECUTION_HEADING = re.compile(
    r"\b(?:exhibit|schedule|annex|annexure|appendix|attachment|signatures?|execution"
    r"|witness|certificate|acceptance|form)\b", re.I)
FORM_LINE_MAX_WORDS = 16
FORM_LINE_MAX_OTHER_WORDS = 5


def is_form_line(text):
    """A signature or fill-in line: blanks or a [[placeholder]], a form word,
    no verb, and little else.

    'Employee Signature ________ Date: ______'   -> True
    '[[ Signature: Client (c60079d8) ]]'         -> True
    'The Effective Date is __________.'          -> False (a sentence)
    """
    t = (text or "").strip()
    if not t or len(t.split()) > FORM_LINE_MAX_WORDS or not _FORM_BLANK.search(t):
        return False
    # blanks go, but a placeholder's own words stay: [[ Signature: Client ]]
    bare = re.sub(r"_{4,}|\.{6,}|[\[\]]", " ", t)
    words = [w.strip(".,:;()[]'’\"").lower() for w in bare.split()]
    words = [w.removesuffix("'s").removesuffix("’s") for w in words if w]
    if any(w in _VERBISH for w in words):
        return False
    signing = any(w in _SIGNING_WORDS for w in words)
    if not signing and len({w for w in words if w in _FIELD_WORDS}) < 2:
        return False
    return sum(1 for w in words if w not in _FORM_WORDS) <= FORM_LINE_MAX_OTHER_WORDS


def is_colon_subclause(text):
    """True when an unnumbered paragraph should become a sub-clause of its own."""
    if not switches.DETECT_COLON_TITLES:
        return False
    title, _rest = title_lead_in(text)
    return title is not None


def _open_heading(headings, depth, text):
    """The headings in force after one at `depth` opens: those above it stay."""
    kept = {d: t for d, t in headings.items() if d < depth}
    kept[depth] = text or ""
    return kept


def _form_block_depth(headings):
    """Under the nearest exhibit or signatures heading in force, so a Statement
    of Work keeps its own signature block; at the top level otherwise, since a
    signature block belongs to no operative section."""
    for depth in sorted(headings, reverse=True):
        if _EXECUTION_HEADING.search(headings[depth]):
            return depth + 1
    return 0


def _outline_ranks(records):
    """outline level -> heading depth. Ranked over the levels the content uses,
    so Heading2 is depth 0 in a document with no Heading1."""
    levels = sorted({r["outline"] for r in records
                     if r["bucket"] == CONTENT and r["outline"] is not None})
    if not switches.RANK_OUTLINE_LEVELS:
        return {lvl: lvl for lvl in levels}
    return {lvl: i for i, lvl in enumerate(levels)}


_MAX_ILVL = 8   # Word list levels run 0..8


def _list_depth(base, reseat, ilvl):
    """Depth of a list item: the list's base plus its level, shifted where a
    heading re-seated that level."""
    return base + ilvl + (reseat or {}).get(ilvl, 0)


def _assign_roles(records, numbering):
    """Decide node/continuation, depth, display number and source for every
    content record."""
    ctr, lexer = Counters(numbering), LexicalDepth()
    heading_depth = -1
    headings = {}         # depth -> text of each heading in force
    colon_parent = None   # depth of the clause colon lead-ins nest under
    defn_depth = None     # depth of the definitions list in force, once opened
    front_open = False    # a preamble node has been opened
    open_depth = None     # depth of the most recent clause of any kind
    anchor_depth = None   # depth of the most recent Word-numbered clause
    base_pinned = {}
    seen_under = {}       # list -> heading generation when last used
    levels_seen = {}      # list -> list levels it has placed an item on
    reseated = {}         # list -> {level: depth shift} set by a heading
    heading_seq = 0       # increments on every heading, marking a new region
    xml_anywhere = any(r["xml_ok"] for r in records if r["bucket"] == CONTENT)
    rank = _outline_ranks(records)

    form_open = False     # the previous content paragraph was a form line

    for r in records:
        if r["bucket"] != CONTENT:
            continue
        was_form, form_open = form_open, False

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
            key = (numbering.list_key(r["numId"]) if switches.SHARE_ABSTRACT_COUNTERS
                   else str(r["numId"]))
            if key not in base_pinned:
                # a list first seen inside an open clause is a sub-list of it
                nest = (open_depth + 1) if open_depth is not None else 0
                base_pinned[key] = max(heading_depth + 1, nest, 0)
                seen_under[key] = heading_seq
            elif switches.RECOMPUTE_NUMBERING_BASE and seen_under.get(key) != heading_seq:
                # the list resumed under a different heading: it moves under that
                # heading, unless the heading sits deeper than the list does
                rebased = min(base_pinned[key], max(heading_depth + 1, 0))
                if rebased != base_pinned[key]:
                    base_pinned[key] = rebased
                    reseated.pop(key, None)
                seen_under[key] = heading_seq
            depth = _list_depth(base_pinned[key], reseated.get(key), r["ilvl"])
            heading = rank.get(r["outline"]) if r["outline"] is not None else None
            first_at_level = r["ilvl"] not in levels_seen.setdefault(key, set())
            levels_seen[key].add(r["ilvl"])
            if switches.ANCHOR_NUMBERED_HEADINGS and heading is not None:
                names_parent = _declared_parent({"canonical_path": path, "display_number": disp})
                if heading < depth and first_at_level and not names_parent:
                    # the list would bury this heading: re-seat this level and
                    # the levels below it on the heading. Levels above are
                    # already placed and stay put. Only the first item at a level
                    # may do this, so a stray heading style on a later sibling
                    # cannot move it, and never one whose number names its
                    # parent (3.1 belongs under 3 wherever the heading style says).
                    shift = heading - (base_pinned[key] + r["ilvl"])
                    reseated[key] = {lvl: shift for lvl in range(r["ilvl"], _MAX_ILVL + 1)} | {
                        lvl: s for lvl, s in reseated.get(key, {}).items() if lvl < r["ilvl"]}
                    depth = heading
                heading_depth = depth
                headings = _open_heading(headings, depth, r["text"])
            r["heading"] = heading is not None
            conflict = bool(r["lex"] and r["lex"]["display"] and disp
                            and r["lex"]["display"].strip(".() ") != disp.strip(".() "))
            r.update(role="node", depth=max(depth, 0),
                     display=disp, path=path,
                     src="word_numbering:" + (r["num_src"] or "?"),
                     conf=0.6 if conflict else 1.0, conflict=conflict)
            open_depth = anchor_depth = colon_parent = r["depth"]
            if defn_depth is not None and r["depth"] < defn_depth:
                defn_depth = None   # a clause above the list closes it
            continue

        # 2. Outline heading carrying no numbering
        if r["outline"] is not None:
            lexer.reset()
            heading_depth = rank[r["outline"]]
            headings = _open_heading(headings, heading_depth, r["text"])
            heading_seq += 1
            r.update(role="node", depth=heading_depth, display=None, path=None, heading=True,
                     src="outline_level", conf=0.95, conflict=False)
            open_depth = anchor_depth = colon_parent = r["depth"]
            if defn_depth is not None and r["depth"] < defn_depth:
                defn_depth = None   # a heading above the list closes it
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

        # 3b. Signature and form lines ("Print Name ______"). They belong to no
        #     operative clause: the first opens a block under the heading in
        #     force, the ones straight after it are its body.
        if switches.SEPARATE_FORM_LINES and is_form_line(r["text"]):
            if was_form:
                r["role"] = "continuation"
            else:
                # inside an exhibit or a signatures section it stays there;
                # after an ordinary section it is the document's own block
                depth = _form_block_depth(headings)
                r.update(role="node", depth=depth, display=None, path=None,
                         src="form_line", conf=0.8, conflict=False)
                # a colon line after the block is its sibling, never its child
                open_depth, colon_parent = r["depth"], r["depth"] - 1
            form_open = True
            continue

        # 3c. A definitions-list entry ('"Business Day" means ...'), which the
        #     document writes without numbering. The depth is pinned at the
        #     first entry and reused, so an entry that follows a numbered
        #     sub-list inside an earlier definition returns to the list's own
        #     level instead of nesting under that sub-list's last item.
        term = definition_term(r["text"])
        if term is not None:
            if defn_depth is None:
                defn_depth = ((open_depth + 1) if open_depth is not None
                              else max(heading_depth + 1, 0))
            r.update(role="node", depth=defn_depth, display=None, path=None,
                     term=term, src="definition_term", conf=0.7, conflict=False)
            open_depth = colon_parent = defn_depth
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

    def number(r):
        raw = (r.get("path") or r.get("display") or "").strip().strip(". ()")
        return _as_number(raw) or raw

    numbered = set()
    for r in nodes:
        n = number(r)
        if n:
            numbered.add(n)

    promoted = 0
    for idx, r in enumerate(content):
        if r.get("role") != "node":
            continue
        num = number(r)
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
            "table_cells": [], "children": [], "_pi": None, "_heading": False}


def _new_node(r, nid):
    txt = (r["lex"]["rest"]
           if (r.get("src") in ("typed_numbering", "inline_split") and r["lex"])
           else r["text"])
    node = _empty_node("c%d" % nid, r["depth"])
    # "Employee Signature ____ Date:" has a colon but no title
    if r.get("src") == "form_line":
        title = None
    elif r.get("src") == "definition_term":
        title = r.get("term")       # the defined term names the clause
    else:
        title = title_lead_in(txt)[0]
    node.update(display_number=r.get("display"), clause_title=title,
                canonical_path=r.get("path"), numbering_source=r.get("src"),
                confidence=r.get("conf"), conflict=r.get("conflict", False),
                style=r["style"], text=txt, _pi=r["i"], _heading=bool(r.get("heading")))
    return node


def _placeholder(number, depth, nid):
    """A parent the document never wrote as its own paragraph."""
    node = _empty_node("c%di" % nid, depth)
    node.update(display_number=number, canonical_path=number,
                numbering_source="inferred_parent", confidence=0.5)
    return node


def _as_number(s):
    """'2.1.' -> '2.1', '3.0' -> '3' (a document's way of writing section 3),
    anything that is not a dotted number -> None."""
    s = (s or "").strip().strip(".")
    if not _DOTTED_NUMBER.fullmatch(s):
        return None
    if switches.ZERO_SECTION_NUMBERS:
        parts = s.split(".")
        while len(parts) > 1 and parts[-1] == "0":
            parts.pop()
        s = ".".join(parts)
    return s


def _numbers_of(node):
    """Every dotted number a clause answers to: Word's own path and the number
    it displays. They differ when a heading level is lettered (path 'C.2',
    display '2.')."""
    found = (_as_number(node.get("canonical_path")), _as_number(node.get("display_number")))
    return {n for n in found if n}


def _number_of(node):
    """The clause's own dotted number, e.g. '2.1', or None. Word's path first,
    the displayed number when the path is not a plain dotted number."""
    return _as_number(node.get("canonical_path")) or _as_number(node.get("display_number"))


def _declared_parent(node):
    """The parent a dotted number names: '2.1' -> '2'. None if it names none."""
    n = _number_of(node)
    if not n or "." not in n:
        return None
    return n.rsplit(".", 1)[0]


def _contradicts(want, stack):
    """True when a placeholder numbered `want` would sit under a numbered clause
    it is not part of: a '1' invented under clause 2 is worse than no parent."""
    for e in reversed(stack):
        nums = _numbers_of(e)
        if nums:
            return not any(want.startswith(n + ".") for n in nums)
    return False


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
            parent_found = False
            if want:
                at = next((k for k, e in reversed(list(enumerate(stack))) if want in _numbers_of(e)), None)
                if at is not None:
                    # the named parent is open: nest under it whatever the depths
                    del stack[at + 1:]
                    parent_found = True
                else:
                    d = max(n["assigned_depth"] - 1, 0)
                    while stack and stack[-1]["assigned_depth"] >= d:
                        stack.pop()
                    if not _contradicts(want, stack):
                        ph = _placeholder(want, d, nid)
                        nid += 1
                        inferred += 1
                        (stack[-1]["children"] if stack else root["children"]).append(ph)
                        stack.append(ph)

            if not parent_found and n["_heading"] and switches.HEADINGS_OUTRANK_LIST_ITEMS:
                while stack and not stack[-1]["_heading"]:
                    stack.pop()
            while not parent_found and stack and stack[-1]["assigned_depth"] >= n["assigned_depth"]:
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
