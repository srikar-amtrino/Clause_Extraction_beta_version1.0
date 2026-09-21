"""The canonical vocabulary: versioned data in, two lookups out.

A taxonomy version is seeded once, from taxonomies/<version>.json, by a data
migration, and never edited afterwards. A classification stores a foreign key
to the type it was given, so rewriting a type under it would silently change
what an old verdict says. A new vocabulary is a new file and a new migration.

Two lookups sit on top of the rows:

- `canonicalize` maps a label written by the model or a person back to a type,
  through exact names and literal aliases only. "SOS" resolves; "Scope" does
  not, because the taxonomy never lists it.
- `expected_keys` reads a section's heading trail and returns the types its
  wording implies. That feeds the deviation check, never the label itself.
"""
import json
import re
import threading
import unicodedata
from pathlib import Path

TAXONOMY_DIR = Path(__file__).resolve().parent / 'taxonomies'

CLAUSE = 'clause'
NON_CLAUSE = 'non_clause'

# Typographic variants a heading may carry that must not defeat a match.
_FOLD = str.maketrans({
    '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-',
    '‘': "'", '’': "'", '“': '"', '”': '"',
})
_SPACE = re.compile(r'\s+')


def normalize(text):
    """The comparison form of a heading or a label.

    Stored as CanonicalTypeAlias.match_key, so lookups compare against the
    stored value. Changing this means re-deriving every stored key in a data
    migration, not just editing the function.
    """
    text = unicodedata.normalize('NFKC', text or '').translate(_FOLD).casefold()
    return _SPACE.sub(' ', text).strip()


def read_taxonomy_file(version):
    """The raw taxonomy data for one version."""
    path = TAXONOMY_DIR / ('%s.json' % version)
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    if data.get('version') != version:
        raise ValueError('%s declares version %r, expected %r'
                         % (path.name, data.get('version'), version))
    return data


def alias_rows(entry):
    """One taxonomy entry's aliases -> [(alias, match_key, is_literal, note)].

    A plain string is a literal heading. An object carries a parenthetical from
    the source: `match` is the surface form a document would contain, `note`
    the parenthetical, and `literal` whether that surface form may be used as a
    lookup key at all.
    """
    rows = []
    for item in entry['aliases']:
        if isinstance(item, str):
            rows.append((item, normalize(item), True, ''))
        else:
            rows.append((item['alias'], normalize(item['match']), bool(item['literal']),
                         item.get('note', '')))
    return rows


def seed_taxonomy(apps, version):
    """Load one taxonomy version into the database. For data migrations: takes
    the historical app registry, so it runs against the schema as it was."""
    CanonicalType = apps.get_model('document_pipeline', 'CanonicalType')
    CanonicalTypeAlias = apps.get_model('document_pipeline', 'CanonicalTypeAlias')
    CanonicalTypeExclusion = apps.get_model('document_pipeline', 'CanonicalTypeExclusion')

    data = read_taxonomy_file(version)
    by_key = {}
    for order, entry in enumerate(data['types'], start=1):
        by_key[entry['key']] = CanonicalType.objects.create(
            version=version, applies_to=entry['applies_to'], number=entry['number'],
            key=entry['key'], name=entry['name'], definition=entry['definition'],
            sort_order=order)

    aliases, exclusions = [], []
    for entry in data['types']:
        ctype = by_key[entry['key']]
        for position, (alias, key, literal, note) in enumerate(alias_rows(entry)):
            aliases.append(CanonicalTypeAlias(
                canonical_type=ctype, version=version, alias=alias, match_key=key,
                is_literal=literal, note=note, position=position))
        for position, ex in enumerate(entry['excludes']):
            exclusions.append(CanonicalTypeExclusion(
                from_type=ctype, to_type=by_key[ex['key']], note=ex['note'],
                position=position))
    CanonicalTypeAlias.objects.bulk_create(aliases)
    CanonicalTypeExclusion.objects.bulk_create(exclusions)


def unseed_taxonomy(apps, version):
    """Reverse of seed_taxonomy. Refused by PROTECT once any classification
    points at the version, which is the point."""
    apps.get_model('document_pipeline', 'CanonicalType').objects.filter(version=version).delete()


class TypeEntry:
    """One canonical type as the classifier sees it. Immutable."""

    __slots__ = ('key', 'name', 'applies_to', 'number', 'definition',
                 'aliases', 'literal_keys', 'excludes')

    def __init__(self, *, key, name, applies_to, number, definition, aliases,
                 literal_keys, excludes):
        self.key = key
        self.name = name
        self.applies_to = applies_to
        self.number = number
        self.definition = definition
        self.aliases = tuple(aliases)            # verbatim, source order, incl. sense notes
        self.literal_keys = tuple(literal_keys)  # normalised; the only lookup keys
        self.excludes = tuple(excludes)          # (target key, note)

    def __repr__(self):
        return '<TypeEntry %s>' % self.key


class Vocabulary:
    """One taxonomy version, with the lookups built once."""

    def __init__(self, version, types):
        self.version = version
        self.types = tuple(types)
        self.by_key = {t.key: t for t in self.types}
        self.by_name = {t.name: t for t in self.types}
        self.clause_types = tuple(t for t in self.types if t.applies_to == CLAUSE)
        self.non_clause_types = tuple(t for t in self.types if t.applies_to == NON_CLAUSE)
        self.clause_names = tuple(t.name for t in self.clause_types)
        self.non_clause_names = tuple(t.name for t in self.non_clause_types)

        lookup = {}
        for t in self.types:
            for match_key in t.literal_keys:
                lookup[match_key] = t.key
        # Names win over aliases. The seed data has no name that is also
        # another type's alias; this only decides what would happen if one did.
        for t in self.types:
            lookup[normalize(t.name)] = t.key
        self._lookup = lookup

        # One alternation, longest surface form first, so at any position the
        # longest heading wins: "general obligations of supplier" is consumed
        # whole before "general" can match inside it.
        alternatives = sorted(lookup, key=lambda k: (-len(k), k))
        self._pattern = re.compile(
            r'(?<!\w)(?:%s)(?!\w)' % '|'.join(re.escape(k) for k in alternatives))

    def canonicalize(self, raw, applies_to=None):
        """A label -> its TypeEntry, or None. Never guesses: only exact names
        and literal aliases resolve, and only within `applies_to` when given."""
        key = self._lookup.get(normalize(raw))
        if key is None:
            return None
        entry = self.by_key[key]
        if applies_to is not None and entry.applies_to != applies_to:
            return None
        return entry

    def expected_keys(self, *texts):
        """The type keys the given headings imply, sorted.

        Matches whole phrases only, left to right, never overlapping. A false
        match can only widen the result, so it can suppress a deviation flag
        but can never produce a wrong label.
        """
        found = set()
        for text in texts:
            for match in self._pattern.finditer(normalize(text)):
                found.add(self._lookup[match.group(0)])
        return sorted(found)


def vocabulary_from_file(version):
    """Build a Vocabulary straight from the data file, without the database.

    For checks that must not depend on migration state (check_bedrock) and for
    proving the seeded rows match the file they came from.
    """
    data = read_taxonomy_file(version)
    types = []
    for entry in data['types']:
        rows = alias_rows(entry)
        types.append(TypeEntry(
            key=entry['key'], name=entry['name'], applies_to=entry['applies_to'],
            number=entry['number'], definition=entry['definition'],
            aliases=[alias for alias, _, _, _ in rows],
            literal_keys=[key for _, key, literal, _ in rows if literal],
            excludes=[(ex['key'], ex['note']) for ex in entry['excludes']],
        ))
    return Vocabulary(version, types)


_cache = {}
_cache_lock = threading.Lock()


def load_vocabulary(version):
    """The Vocabulary for a version, read from the database once per process.

    Cached by version string. Seeded versions are immutable, so a cached entry
    can only go stale if rows are edited by hand, which the design forbids.
    """
    with _cache_lock:
        vocab = _cache.get(version)
        if vocab is None:
            vocab = _cache[version] = _vocabulary_from_db(version)
        return vocab


def clear_vocabulary_cache():
    with _cache_lock:
        _cache.clear()


def _vocabulary_from_db(version):
    from document_pipeline.models import CanonicalType

    rows = list(CanonicalType.objects
                .filter(version=version, is_active=True)
                .prefetch_related('aliases', 'exclusions__to_type')
                .order_by('sort_order'))
    if not rows:
        raise LookupError('No canonical types for taxonomy version %r. '
                          'Run `python manage.py migrate document_pipeline`.' % version)
    types = []
    for row in rows:
        aliases = sorted(row.aliases.all(), key=lambda a: a.position)
        exclusions = sorted(row.exclusions.all(), key=lambda e: e.position)
        types.append(TypeEntry(
            key=row.key, name=row.name, applies_to=row.applies_to, number=row.number,
            definition=row.definition,
            aliases=[a.alias for a in aliases],
            literal_keys=[a.match_key for a in aliases if a.is_literal],
            excludes=[(e.to_type.key, e.note) for e in exclusions],
        ))
    return Vocabulary(version, types)
