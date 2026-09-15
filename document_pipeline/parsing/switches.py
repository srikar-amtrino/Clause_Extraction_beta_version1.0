"""Behaviour switches for the extractor.

Each switch fixes one specific defect and can be turned off on its own, which
reproduces the older behaviour on the same file for before/after comparison.
Modules read these through the module (`switches.NAME`) so a test can flip one.
"""

# ---------------------------------------------------------------- text
ACCEPT_TRACKED = True   # accept w:ins / w:moveTo, drop w:del / w:moveFrom
SKIP_HIDDEN = True      # drop runs marked w:vanish (hidden text)

# ---------------------------------------------------------------- structure
# Word reserves outlineLvl 9 for body text. Reading it as a heading at depth 9
# produces phantom deep clauses.
TREAT_OUTLINE_9_AS_BODY = True

# Front matter (cover page, parties, recitals) is kept out of the clause tree.
# Off -> front matter becomes clauses and pushes every real clause deeper.
REMOVE_FRONT_MATTER = True

# Paragraphs styled TOC1..TOC9 are Word's generated table of contents.
REMOVE_TOC = True

# Table cell paragraphs never become clauses. Their text is kept with table,
# row and column coordinates, attached to the enclosing clause.
ISOLATE_TABLES = True

# An unnumbered section heading whose run formatting matches the headings this
# document did number is promoted into a missing parent slot.
PROMOTE_MATCHING_HEADINGS = True

# A clause numbered 2.1 declares its parent, clause 2. Where that parent was never
# written, an inferred placeholder is created so 2.1 does not nest under clause 1.
REPAIR_SKIPPED_ANCESTORS = True

# Depth for typed numbering comes from a context stack rather than a fixed
# token-class map. Off -> depth is capped and (a) collides with (A).
LEXICAL_CONTEXT_STACK = True

# A numbered list's base depth is recomputed at each occurrence from the heading
# in force, so a Schedule that reuses a numbering id nests correctly.
RECOMPUTE_NUMBERING_BASE = True

# ---------------------------------------------------------------- inline clauses
# Off -> a paragraph is always exactly one record.
SPLIT_INLINE_CLAUSES = True

# Widen the inline scanner to plain "7." and "(a)" starts. Both appear constantly
# inside prose, so this stays off until measured on real documents.
SPLIT_WEAK_CLASSES = False

# Neither side of an inline cut may be shorter than this.
SPLIT_MIN_CHARS = 25

# ---------------------------------------------------------------- front matter
# Off -> front matter is deleted wholesale. On -> only administrative noise is
# dropped and substantive preamble text is kept.
KEEP_SUBSTANTIVE_FRONT_MATTER = True

# A front-matter line at or under this length carrying no sentence is treated as
# administrative: an address line, a page counter, a version stamp.
NOISE_MAX_CHARS = 50

# ---------------------------------------------------------------- colon lead-ins
DETECT_COLON_TITLES = True
TITLE_MAX_WORDS = 5
TITLE_MAX_CHARS = 70

# ---------------------------------------------------------------- flags
# Off -> the flags array is emitted empty on every clause.
EMIT_FLAGS = True
