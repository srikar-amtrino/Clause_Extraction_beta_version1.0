"""What the model is told.

The system prompt is fixed per (PROMPT_VERSION, taxonomy version) and rendered
byte-identically every time, behind an explicit cache breakpoint: it is several
thousand tokens that repeat on every request, and caching is a prefix match,
so a single varying byte (a timestamp, an unordered set) would silently turn
every call into a full-price one. Everything that varies goes in the user
message, after the breakpoint.

The breakpoint is explicit rather than the top-level automatic form because
Bedrock's InvokeModel path rejects top-level cache_control.

Guidance on exhibits, title-only paragraphs, definitions, list fragments and
cross-references is carried over from the proof-of-concept prompt, which was
exercised on real contracts. Its hard rule that every paragraph inherits its
section's type is not: under this taxonomy a single "Term and Termination"
section legitimately holds two types.
"""
import hashlib
import json

# Bump whenever the rendered text or the user-message format changes. A run
# records it, and a run at an older prompt version is not current work.
PROMPT_VERSION = 'v1'

MACRO_PREVIEW_WORDS = 15

_INSTRUCTIONS = """\
You classify paragraphs taken from commercial contracts. Each paragraph gets a label, Clause or Non-clause, and a canonical type from the taxonomy at the end of these instructions. A Clause also gets a sub_type.

## Clause or Non-clause

A Clause is an operative provision: an obligation, right, condition, restriction, definition, warranty, term or scope statement that binds a party or governs the agreement.

A Non-clause is everything else in the document: the title, the parties, the preamble, recitals, a table of contents, signature blocks, schedule and exhibit headers, page furniture, notes, template placeholders and stray fragments.

Get these right:
- A paragraph that is only the title of a standard provision, such as "Limitation of Liability" or "12. Confidentiality", is a Clause of that provision's type. Its body may sit in a separate paragraph; the heading still belongs to the provision.
- A definition, such as '"Services" means the work described in a Statement of Work', is a Clause. Defining a term is operative.
- A list item or fragment that continues a provision, such as "(iii) any breach of Section 8;", is a Clause even without its own subject and verb. Its lead-in, when shown, says which provision it completes.
- A paragraph that only points elsewhere, such as "See Section 8.2." or "Refer to Exhibit A.", and adds nothing of its own is a Non-clause: Notes & References.
- A placeholder inside operative text, such as "The fee is [●] per month.", does not make the paragraph a Non-clause. Only a paragraph that is nothing but a placeholder or a drafting instruction is Template Placeholder.

## Schedules, exhibits and annexes

- A heading that only names or introduces an attachment, such as "Exhibit A", "Schedule 1: Pricing" or "Exhibit A - Statement of Work", is a Non-clause: Schedule & Exhibit Identification.
- Content inside an attachment is classified like any other paragraph. If it states an obligation, right, condition, definition, warranty, term or restriction, it is a Clause. Purely descriptive or tabular material with no binding language, such as a pricing table row, a narrative list of deliverables or a caption, is a Non-clause.
- Attachments restart their own numbering. A paragraph numbered 1.1 inside Exhibit A belongs to that exhibit's structure, not the main agreement's; judge it on its substance.
- A signature or initials line at the foot of an attachment is Signature Block, like the main one.

## Section context

Each paragraph is shown inside its section, with the heading trail it sits under and its sibling paragraphs. Paragraphs in one section usually share a type, so treat the section heading as strong evidence and keep siblings consistent where their substance allows. But label each paragraph by what it does, not by where it sits: when its substance belongs to a different type, choose that type and say why in reason.

The taxonomy is finer than many documents' headings. Under "Term and Termination", a paragraph fixing the initial term is Term & Renewal, while a right to end the agreement early is Suspension & Termination. A paragraph that only adds procedure to the provision around it, such as how a termination notice must be served, takes that provision's type; the general machinery for all notices is Notices.

## canonical_type

- Use exactly one name from the taxonomy, spelled as listed: a clause type for a Clause, a non-clause type for a Non-clause.
- Use each type's definition and its "Excludes" line to separate neighbouring types. An alias with a note in parentheses applies only in that sense.
- If a paragraph is a Clause but none of the clause types fits it, set canonical_type to null. Do not force a poor fit. General Provisions covers only the residual boilerplate its definition lists; it is not a catch-all.
- The document line gives the contract type when it is known. The taxonomy is written for master services agreements; in other contracts, choose the type that matches the substance.

## sub_type (Clause only)

1. If the paragraph has its own title, given as its title, as the last step of its heading trail, or as a short run-in heading at the start of its text, use that title exactly, changing only casing and punctuation, provided it describes what the paragraph does. Never paraphrase a title the document gives.
2. Otherwise write a concise 2-4 word Title Case description of what the paragraph does, in the register of a contract heading, with minor words such as "of", "for" and "and" in lower case: "Initial Term", "Termination for Breach", "Customer Obligations", "Cure Period". Never copy a sentence fragment.

## confidence and reason

- confidence is the probability that both label and canonical_type are right. Reserve values above 0.9 for unambiguous cases. Use 0.6-0.8 for short paragraphs, title-only paragraphs, fragments, or a paragraph that could fit two types. Go lower only when either reading is plausible.
- reason is one sentence naming the wording or context that decided the type.

## Input and output

The input lists groups of paragraphs; each group is one section. Every paragraph has an id such as p3. Return exactly one item per id, with the id exactly as given. Do not skip, merge, split or invent ids."""


def render_system_prompt(vocab):
    """The full system prompt for a vocabulary. Deterministic: same input,
    same bytes, every time."""
    parts = [_INSTRUCTIONS, '', '## Taxonomy (version %s)' % vocab.version]
    for heading, types, prefix in (('Clause types', vocab.clause_types, ''),
                                   ('Non-clause types', vocab.non_clause_types, 'N')):
        parts += ['', '### %s' % heading]
        for t in types:
            parts += ['', '%s%d. %s' % (prefix, t.number, t.name), t.definition]
            if t.aliases:
                parts.append('Also appears as: %s' % '; '.join(t.aliases))
            if t.excludes:
                parts.append('Excludes: %s' % '; '.join(
                    '%s (%s)' % (vocab.by_key[key].name, note) for key, note in t.excludes))
    return '\n'.join(parts) + '\n'


def prompt_sha256(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def system_blocks(text):
    """The system prompt as one cached block."""
    return [{'type': 'text', 'text': text, 'cache_control': {'type': 'ephemeral'}}]


def preview(text, words=MACRO_PREVIEW_WORDS):
    parts = (text or '').split()
    if len(parts) <= words:
        return ' '.join(parts)
    return ' '.join(parts[:words]) + ' ...'


def render_user_message(batch, *, document_title, contract_type):
    """The variable half of a request: document context, then each section's
    paragraphs under their batch-local ids."""
    ids_by_chunk = {p.chunk_id: pid for pid, p in batch.ids.items()}
    groups = []
    for group in batch.groups:
        paragraphs = []
        for p in group.paragraphs:
            entry = {'id': ids_by_chunk[p.chunk_id]}
            if p.number:
                entry['number'] = p.number
            if p.title:
                entry['title'] = p.title
            if p.heading_trail:
                entry['heading_trail'] = p.heading_trail
            if p.lead_in:
                entry['lead_in'] = p.lead_in
            if p.region and p.region != 'body':
                entry['region'] = p.region
            entry['text'] = p.text
            paragraphs.append(entry)
        section = {}
        if group.section:
            section['section'] = group.section
        if group.preview:
            section['section_opening'] = group.preview
        section['paragraphs'] = paragraphs
        groups.append(section)
    payload = {
        'document': {'title': document_title or 'untitled',
                     'contract_type': contract_type or 'unknown'},
        'groups': groups,
    }
    return ('Classify every paragraph below. Return exactly one item per id.\n\n'
            + json.dumps(payload, ensure_ascii=False, indent=1))
