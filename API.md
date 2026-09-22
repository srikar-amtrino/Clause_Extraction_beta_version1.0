# Pipeline API

What the backend exposes to the review frontend. Two groups:

- **Ingestion** — `/api/google-drive/*`. Connect a Drive account, pick folders,
  sync. These *write* and queue work. Documented by their use in
  `src/services/googleDriveService.js`.
- **Results** — `/api/documents/*` and `/api/taxonomy/`. Everything the pipeline
  produced. **Read-only**: no endpoint below starts a parse or a classification
  run, so they are safe to call on mount, on focus, or on a poll.

This page covers the results group. Client wrapper:
`src/services/documentService.js`.

## Conventions

**Base URL.** In development the backend runs on `http://127.0.0.1:8000` and
Vite proxies `/api` to it (`vite.config.js`). Call the **relative** path —
`/api/documents/` — so the request is same-origin, the session cookie is sent,
and there is no CORS to configure. `documentService.js` falls back to the
absolute URL if the proxy is not running.

**Auth.** Session cookie, set by the Drive OAuth callback. Send
`credentials: 'include'` on every request. The results endpoints do not check it
today, but they will, so send it now.

**Errors.** Always JSON, always the same shape, always a real status code:

```json
{ "detail": "No document with that id." }
```

| status | means |
|---|---|
| `400` | a bad query parameter — `detail` says which; some add `allowed` |
| `404` | no document with that id, or no taxonomy at that version |
| `405` | wrong method — these are all `GET` |

**Nulls.** A stage that has not run is `null`, never an empty object or a zero.
Test `if (doc.stages.classification)`, not `.micro_chunks > 0`.

**Ids.** `document_id` is a UUID. `clause_id` (`"c32"`) and `paragraph_id`
(`"P-003"`) are *local* to one extraction run — they tie the three views of a
document together, but they are not globally unique. Don't key a cache on them
without the document id.

---

## `GET /api/documents/`

The document list, newest first. This is the one call a list screen needs — each
row already carries the outcome of every stage, so no per-row follow-up.

| parameter | repeatable | notes |
|---|---|---|
| `folder_id` | yes | Drive folder the file was found in |
| `status` | yes | `pending` · `extracted` · `extracted_with_warnings` · `rejected` · `failed` |
| `classified` | no | `true` / `false` — whether a current classification run exists |
| `q` | no | substring of the file name, case-insensitive |
| `limit` | no | defaults to `50`, silently capped at `200` |
| `offset` | no | |

```json
{
  "documents": [
    {
      "document_id": "d0adaa81-4501-4ca2-99a9-10e8d4985a9b",
      "name": "master-services-agreement.docx",
      "title": "MASTER SERVICES AGREEMENT",
      "drive_file_id": "18BdNLjuGbZKg7ATLoPJ0IjkLzxEgSczi",
      "drive_folder_id": "1pDMacP3Hn3fJHht28uxjxF2wYwykRuF6",
      "drive_web_link": "https://docs.google.com/document/d/.../edit",
      "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "extraction_status": "extracted",
      "last_extracted_at": "2026-09-18T12:18:12+00:00",
      "stages": {
        "extraction": {
          "run_id": "96736b4b-...", "status": "extracted", "attempt": 1,
          "pages": 4, "clauses": 430, "paragraphs": 539,
          "warnings": [], "extracted_at": "2026-09-18T12:18:12+00:00"
        },
        "classification": {
          "run_id": "d9c706c3-...", "status": "succeeded", "attempt": 1,
          "taxonomy_version": "v1",
          "micro_chunks": 338, "classified": 338, "unclassified": 0,
          "failed": 0, "needs_review": 97,
          "classified_at": "2026-09-21T07:08:13+00:00"
        }
      },
      "links": {
        "self": "/api/documents/d0adaa81-.../",
        "extraction": "/api/documents/d0adaa81-.../extraction/",
        "classification_input": "/api/documents/d0adaa81-.../classification-input/",
        "classification": "/api/documents/d0adaa81-.../classification/"
      }
    }
  ],
  "page": { "total": 198, "limit": 50, "offset": 0, "returned": 50, "has_more": true }
}
```

Follow `links` rather than building detail URLs — if a path moves, the response
moves with it and the frontend does not need a release.

`extraction_status` is the document's own mirror of the current run's status, so
it is safe to render for a row whose `stages.extraction` is `null` (nothing has
run yet → `pending`).

## `GET /api/documents/<id>/`

One document — byte for byte the object the list returns. A detail screen opened
by deep link can call this and render with the same component the list row uses.

---

## `GET /api/documents/<id>/extraction/`

The current extraction run: what the parser found. Around 500 KB for a 4-page
agreement, so fetch it when a document is opened, not for a list.

```json
{
  "document": { "document_id": "...", "name": "...", "title": "MASTER SERVICES AGREEMENT",
                "drive_file_id": "...", "drive_folder_id": "...",
                "extraction_status": "extracted" },
  "extraction": {
    "run_id": "96736b4b-...", "attempt": 1, "status": "extracted",
    "parser_build": "2026.09.18b", "extracted_at": "2026-09-18T12:18:12+00:00",
    "page_count": 4, "clause_count": 430, "paragraph_count": 539,
    "max_level": 5, "warnings": [], "rejection": null
  },
  "clauses": [
    { "clause_id": "c32", "parent_id": "c30", "level": 3,
      "number": "(a)", "title": null, "path": "2.3(a)",
      "source": "outline_level", "confidence": 0.95, "flags": ["depth_adjusted"],
      "text": "…the clause and everything under it…",
      "body_text": "…this clause's own text, without its children…" }
  ],
  "paragraphs": [
    { "paragraph_id": "P-003", "page": 1, "bucket": "content",
      "clause_id": "c1", "breadcrumb": "1.", "text": "…" }
  ]
}
```

- `extraction` is `null` when the document has not been parsed. `clauses` and
  `paragraphs` are then empty.
- `clauses` is in **reading order**. Build the tree from `parent_id`
  (`null` = top level); don't sort by `number`, which is a display string.
- `text` includes descendants, `body_text` does not. For a tree view render
  `body_text` at each node, or you will show the same sentence at five levels.
- `flags` and `warnings` are parser self-reports worth surfacing — they mark
  where the structure is least certain.
- `rejection` is non-null only when the parser refused the file; it explains why.

## `GET /api/documents/<id>/classification-input/`

The micro chunks of the current chunk run, grouped by section **exactly as the
classifier batches them**. This is what the model was shown — use it when a user
asks why a clause got the verdict it did.

```json
{
  "document": { "…": "…", "contract_type": "Master Services Agreement" },
  "chunk_run": {
    "chunk_run_id": "cf62d5ad-…", "chunker_version": "2026.09.18",
    "chunk_count": 430, "micro_count": 338, "macro_count": 92,
    "all_clauses_covered": true, "all_paragraphs_covered": true
  },
  "groups": [
    {
      "section": "2 SCOPE OF SERVICES",
      "section_opening": "The Service Provider shall…",
      "paragraphs": [
        { "chunk_id": "bff96a6a-…", "clause_id": "c1", "number": "1.",
          "heading_trail": "1 SAI AU NO.2 PTY LTD", "text": "…" }
      ]
    }
  ]
}
```

- `chunk_run` is `null` when the document has not been chunked.
- Only **micro** chunks appear — the leaf units that get a verdict. `macro_count`
  is the rest of the tree, which is not classified.
- `section`, `section_opening`, `number`, `title`, `heading_trail`, `lead_in` and
  `region` are **omitted when empty**, not sent as `null`. Use optional chaining.
- `all_clauses_covered` / `all_paragraphs_covered` are the chunker's own
  assertion that nothing was dropped. `false` is worth a warning in the UI.

## `GET /api/documents/<id>/classification/`

The current classification run — the verdicts. The main screen's data.

| parameter | notes |
|---|---|
| `needs_review` | `true` returns only flagged items; the summary still counts the whole run |

```json
{
  "document": { "…": "…" },
  "classification_run": {
    "classification_run_id": "d9c706c3-…", "status": "succeeded", "attempt": 1,
    "model_id": "…anthropic.claude-sonnet-4-6", "taxonomy_version": "v1",
    "prompt_version": "v1", "started_at": "2026-09-21T07:05:51+00:00",
    "duration_ms": 142342, "calls": 42,
    "tokens": { "input": 80508, "output": 24835, "cache_read": 285726, "cache_write": 0 },
    "error": null
  },
  "summary": {
    "micro_chunks": 338, "classified": 338, "unclassified": 0,
    "failed": 0, "needs_review": 97,
    "by_outcome": { "classified": 338 },
    "by_type": { "Clause: Payment Terms": 24, "Clause: Confidentiality": 18 }
  },
  "items": [
    {
      "clause_id": "c32",
      "number": "(a)",
      "heading_trail": "2 SCOPE OF SERVICES > 2.3 The Service Provider shall… > (a) If the…",
      "text": "If the Service Provider delays Phases, then either the payments shall be postponed or…",
      "outcome": "classified",
      "label": "Clause",
      "type": "service-provider-obligations",
      "type_name": "Service Provider Obligations",
      "sub_type": "Installation Delay Consequences",
      "confidence": 0.82,
      "reason": "This paragraph imposes consequences on the Service Provider if it delays…",
      "needs_review": true,
      "review_reasons": ["deviated"],
      "expected_types": ["scope-of-services"],
      "deviated": true,
      "error": null
    }
  ],
  "filtered": { "needs_review": true, "returned": 97 }
}
```

- `classification_run` is `null` when the document has not been classified.
  `summary` and `items` are then `null` / empty.
- `filtered` is present **only** when `needs_review=true` was passed.
- `items` is in reading order and has **one entry per micro chunk, always** —
  including the ones that failed. Coverage is provable; nothing drops silently.

### `outcome` — read this before rendering an item

| `outcome` | what it means | what is set |
|---|---|---|
| `classified` | got a type | `label`, `type`, `type_name`, `confidence`, `reason` |
| `unclassified` | a real clause that fits no type in the taxonomy | `label` is always `Clause`; `type` is `null` |
| `failed` | the model never returned a usable answer | `label`, `type` and `confidence` are all `null`; `error` is set |

These are enforced as database constraints, so the combinations above are the
only ones that can ever arrive. `unclassified` is a deliberate state, not an
error — don't render it as one.

### `needs_review` and `review_reasons`

`needs_review` is the queue flag. `review_reasons` is an array — several can
apply at once:

| reason | meaning |
|---|---|
| `low_confidence` | the model was unsure |
| `high_risk` | the clause type carries risk and is always reviewed |
| `deviated` | the verdict fell outside the types the section heading implied — compare `type` against `expected_types` |
| `unclassified` | fits no type in the taxonomy |
| `failed` | no usable answer |

`deviated` is computed by the backend from the heading trail, not reported by the
model, so it catches cases the model did not notice about itself.

## `GET /api/taxonomy/`

The types a verdict can carry. Fetch once and cache — it changes only with a new
taxonomy version.

| parameter | notes |
|---|---|
| `version` | defaults to `v1`, the version the current runs use |
| `include_inactive` | `true` also returns retired types |

```json
{
  "version": "v1",
  "clause_types": [
    { "key": "definitions-and-interpretation", "name": "Definitions and Interpretation",
      "number": 1, "applies_to": "clause",
      "definition": "Defined terms and the rules for reading the agreement…",
      "is_active": true }
  ],
  "non_clause_types": [ "… 11 more …" ]
}
```

35 clause types, 11 non-clause types. An item's `type` matches a type's `key`;
show `name`. `definition` is the wording the classifier was given — good tooltip
text, and the right thing to show a reviewer deciding whether a verdict is fair.

---

## Building the review screen

1. `documentService.list({ classified: true })` → the table. Every column you
   need is in `stages`; no per-row fetch.
2. `documentService.taxonomy()` once at app start → filter menu and tooltips.
3. On opening a document: `documentService.classification(id)` → header from
   `summary`, list from `items`.
4. "Only show what needs review" → `classification(id, { needsReview: true })`.
   The summary is unchanged, so the header can still read "97 of 338".
5. "Why this verdict?" → `classificationInput(id)`, match on `clause_id`, and
   show the section the model actually saw. `reason` and the type's `definition`
   complete the picture.
6. Full clause tree → `extraction(id)`, build from `parent_id`, render
   `body_text`.

## What is not here yet

- **Writing a review decision.** A reviewer's accept/reject has nowhere to go
  over HTTP yet. The tables and the service layer exist behind it; the endpoint
  does not. Say what shape you want and it can follow.
- **Pagination inside a document.** `items` returns all 338. Fine at this size;
  if a screen starts to feel it, ask and it gets a window like the list.
- **Triggering a run.** Parsing and classification are started from management
  commands, not HTTP.
