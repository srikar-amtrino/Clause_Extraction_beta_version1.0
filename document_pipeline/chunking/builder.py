"""Phase 2, chunking: one clause tree in, two kinds of chunk out.

  macro  one per clause that has children. Contains that clause, its body text
         and every descendant at every depth. This is the unit that gets
         indexed and retrieved, so a retrieved passage is never a sub-clause
         torn away from the sentence that gives it meaning.

  micro  one per leaf clause. Carries the parent breadcrumb and the parent
         lead-in so it reads on its own. This is the unit a verdict cites.

Retrieve broad, cite narrow. Macro chunks nest, so a clause's text appears in
its own micro chunk and in the macro chunk of every ancestor. That is
deliberate and it is why chunk output is several times the size of the parse
result.

Chunk boundaries are structural, never size-based: one chunk per clause,
decided only by whether that clause has descendants. A citation has to survive
a lawyer, and "clause 5.i" is one where "characters 4000-4800" is not.
`char_count` and `word_count` are recorded for observation, never consulted.

Nothing is invented here. A title the document does not contain stays null.
Pure functions over plain dicts, with no Django import, so the port can be
diffed against the POC notebook without a database.
"""
import re
from collections import Counter

CHUNK_SCHEMA_VERSION = '1.0'

MACRO = 'macro'
MICRO = 'micro'

# Emitted on every chunk so retrieval can filter later. Nothing is excluded.
REGION_BODY = 'body'
REGION_EXECUTION = 'execution'
REGION_EXHIBIT = 'exhibit'
REGION_MIXED = 'mixed'

_EXEC_HINTS = re.compile(
    r'\b(?:signature|signatures|accepted\s+and\s+agreed|print\s+name'
    r'|designation|in\s+witness\s+whereof|executed\s+in\s+counterparts'
    r'|authorised\s+signatory|authorized\s+signatory)\b', re.I)

_EXHIBIT_HINTS = re.compile(
    r'\b(?:exhibit|annexure|annex|schedule|appendix|order\s+form'
    r'|statement\s+of\s+work)\b[\s\-:]*[A-Z0-9]?', re.I)

# Structural labels for clauses the document itself never titled. These name
# how the extractor found the clause, which is a fact about our own pipeline,
# not an invented legal heading. The chunk's own `title` field stays null.
_SOURCE_LABELS = {
    'front_matter': 'FRONT MATTER',
    'table': 'TABLE',
}


def _index(flat):
    return {r['clause_id']: r for r in flat}


def _children(flat):
    kids = {}
    for r in flat:
        kids.setdefault(r.get('parent_id'), []).append(r)
    for v in kids.values():
        v.sort(key=lambda x: x['order_index'])
    return kids


def _descendants(node, kids):
    """Every descendant at every depth, in document reading order."""
    out = []
    for c in kids.get(node['clause_id'], []):
        out.append(c)
        out.extend(_descendants(c, kids))
    return out


def _own_text(rec):
    """A clause's own text plus its body paragraphs, nothing inherited."""
    parts = [rec.get('text') or '']
    if rec.get('body_text'):
        parts.append(rec['body_text'])
    return '\n'.join(p for p in parts if p.strip()).strip()


def _crumb_label(n):
    """A short label for one step of the trail, never inventing wording.

    Order of preference: the clause's own title, then a leading run of capitals
    (contracts fuse `RESTRICTIONS Customer shall not...` into one paragraph, and
    the capitals are the heading), then a structural label, then a truncated
    opening. Body text is never dragged into the trail whole.
    """
    title = (n.get('clause_title') or '').strip()
    if title:
        return title

    text = (n.get('text') or '').strip()
    words = text.split()
    caps = []
    for w in words[:8]:
        letters = [c for c in w if c.isalpha()]
        if letters and all(c.isupper() for c in letters):
            caps.append(w)
        else:
            break
    if caps and len(' '.join(caps)) >= 3:
        return ' '.join(caps).rstrip('.,:;')

    label = _SOURCE_LABELS.get(n.get('numbering_source'))
    if label:
        return label

    head = text.split('.')[0].strip() or text
    return head[:48].rstrip() + ('...' if len(head) > 48 else '')


def breadcrumb(rec, idx):
    """Readable ancestor path, built from numbers and titles the document
    actually contains."""
    trail = []
    for cid in list(rec.get('ancestor_ids') or []) + [rec['clause_id']]:
        n = idx.get(cid)
        if not n:
            continue
        num = (n.get('display_number') or '').strip().rstrip('.')
        step = ('%s %s' % (num, _crumb_label(n))).strip() if num else _crumb_label(n)
        if step:
            trail.append(step)
    return ' > '.join(trail)


def region_of(rec, idx):
    """body, execution or exhibit. Decided on the clause and its ancestors so a
    child of a signature block inherits the block's region."""
    chain = [idx[c] for c in (rec.get('ancestor_ids') or []) if c in idx] + [rec]
    blob = ' '.join(((n.get('clause_title') or '') + ' ' + (n.get('text') or '')[:160])
                    for n in chain)
    if _EXHIBIT_HINTS.search(blob):
        return REGION_EXHIBIT
    if _EXEC_HINTS.search(blob):
        return REGION_EXECUTION
    return REGION_BODY


def lead_in_of(rec, idx):
    """The parent's own text, which is the sentence a sub-clause completes."""
    p = idx.get(rec.get('parent_id'))
    return _own_text(p) if p else None


def _is_indexed(kind, rec):
    """A chunk is retrievable when nothing larger already contains it.

    Every macro qualifies. A leaf qualifies only when it has no parent: a leaf
    with a parent is already inside that parent's macro, and indexing both
    would put near duplicates in competition. A root level leaf has no macro
    above it, so without this it would be unreachable by search entirely.
    """
    return kind == MACRO or rec.get('parent_id') is None


def _chunk(kind, rec, idx, text, paragraph_ids, child_ids, compound):
    crumb = breadcrumb(rec, idx)
    lead = lead_in_of(rec, idx) if kind == MICRO else None
    return {
        'chunk_id': 'chunk_%s_%s' % (rec['clause_id'], kind),
        'chunk_kind': kind,
        'indexed_for_retrieval': _is_indexed(kind, rec),
        'clause_id': rec['clause_id'],
        'clause_identifier': rec.get('display_number') or None,
        'title': rec.get('clause_title') or None,
        'breadcrumb': crumb,
        'region': region_of(rec, idx),
        'level': rec['level'],
        'parent_id': rec.get('parent_id'),
        'child_ids': child_ids,
        'is_compound_list': compound,
        'lead_in_text': lead,
        'text': text,
        'composite_text': ('Context: %s\nText: %s' % (crumb, text)) if crumb else text,
        'paragraph_ids': paragraph_ids,
        'char_count': len(text),
        'word_count': len(text.split()),
    }


def build_chunks(clauses, paragraphs_by_clause=None):
    """-> (chunks, stats). Macro chunks are the retrieval units, micro chunks
    the citation units. Every clause is represented at least once.

    `clauses` is the parser's flat clause list, or the same shape rebuilt from
    ExtractedClause rows.

    `paragraphs_by_clause` maps clause_id -> the paragraph ids belonging to that
    clause. It is injected rather than read off `clause['paragraph_ids']`
    because those two disagree: the clause field carries only node and body
    paragraphs, so every table cell is missing from it (24 of 226 paragraphs in
    the MSA sample). The database knows the real edge and passes it in; the
    default reproduces the POC exactly so the port stays diffable against the
    notebook.
    """
    flat = list(clauses or [])
    idx, kids = _index(flat), _children(flat)

    def own_paragraphs(rec):
        if paragraphs_by_clause is None:
            return list(rec.get('paragraph_ids') or [])
        return list(paragraphs_by_clause.get(rec['clause_id']) or [])

    chunks = []
    for rec in sorted(flat, key=lambda r: r['order_index']):
        desc = _descendants(rec, kids)

        if desc:
            # macro: this clause plus everything beneath it, in reading order
            body = [_own_text(rec)] + [_own_text(d) for d in desc]
            paras = own_paragraphs(rec)
            for d in desc:
                paras.extend(own_paragraphs(d))
            mc = _chunk(MACRO, rec, idx,
                        '\n'.join(t for t in body if t),
                        sorted(set(paras)),
                        [d['clause_id'] for d in desc],
                        True)
            # a macro swallows its descendants, so its region must reflect
            # everything inside it. A signature block that contains an exhibit
            # is not purely an execution chunk.
            inside = sorted({region_of(n, idx) for n in [rec] + desc})
            mc['regions_included'] = inside
            if len(inside) > 1:
                mc['region'] = REGION_MIXED
            chunks.append(mc)
        else:
            # micro: a leaf, carrying its parent's breadcrumb and lead-in
            mi = _chunk(MICRO, rec, idx,
                        _own_text(rec),
                        own_paragraphs(rec),
                        [],
                        bool(rec.get('is_compound_lead_in')))
            mi['regions_included'] = [mi['region']]
            chunks.append(mi)

    return chunks, _build_stats(flat, chunks, own_paragraphs)


def _build_stats(flat, chunks, own_paragraphs):
    """Coverage gates, not decoration. These are what prove a verdict can be
    traced back to source paragraphs, so they are stored rather than printed."""
    covered = {c for ch in chunks for c in [ch['clause_id']] + ch['child_ids']}
    missing = [r['clause_id'] for r in flat if r['clause_id'] not in covered]

    # Retrieval coverage. Every clause must sit inside at least one chunk that
    # is actually indexed, otherwise it can never be found by search however
    # good the query is.
    reach = {c for ch in chunks if ch['indexed_for_retrieval']
             for c in [ch['clause_id']] + ch['child_ids']}
    unreachable = [r['clause_id'] for r in flat if r['clause_id'] not in reach]

    src = set()
    for r in flat:
        src.update(own_paragraphs(r))
    got = set()
    for ch in chunks:
        got.update(ch['paragraph_ids'])

    sizes = sorted(c['char_count'] for c in chunks)
    return {
        'chunk_schema_version': CHUNK_SCHEMA_VERSION,
        'chunk_count': len(chunks),
        'macro_chunks': sum(1 for c in chunks if c['chunk_kind'] == MACRO),
        'micro_chunks': sum(1 for c in chunks if c['chunk_kind'] == MICRO),
        'indexed_chunks': sum(1 for c in chunks if c['indexed_for_retrieval']),
        'clauses_covered': len(flat) - len(missing),
        'clauses_missing': missing,
        'all_clauses_covered': not missing,
        'clauses_unreachable': unreachable,
        'all_clauses_retrievable': not unreachable,
        'paragraphs_in_source': len(src),
        'paragraphs_in_chunks': len(got),
        'paragraphs_missing': sorted(src - got),
        'all_paragraphs_covered': not (src - got),
        'regions': dict(Counter(c['region'] for c in chunks)),
        'largest_chunk_chars': sizes[-1] if sizes else 0,
        'largest_chunk_id': max(chunks, key=lambda c: c['char_count'])['chunk_id']
                            if chunks else None,
        'median_chunk_chars': sizes[len(sizes) // 2] if sizes else 0,
    }
