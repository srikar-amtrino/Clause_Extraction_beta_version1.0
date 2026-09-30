# Pipeline API

What the backend exposes to the review frontend. Three groups:

- **Ingestion** — `/api/google-drive/*`. Connect a Drive account, pick folders,
  sync. These *write* and queue work. Documented by their use in
  `src/services/googleDriveService.js`.
- **Results** — `/api/documents/*` and `/api/taxonomy/`. Everything the pipeline
  produced. **Read-only**: nothing in this group starts a parse or a
  classification run, so they are safe to call on mount, on focus, or on a poll.
- **Review** — the review screen reads `GET /api/documents/<id>/classification/`
  and saves with `POST /api/documents/<id>/classification/save/`. It takes the
  document's lock through `/api/documents/<id>/workspace/lock/*`. **Needs the
  login token.** A Save stores the reviewer's decision beside the model's
  verdict and never overwrites it: a run stays an audit record. Nothing
  reaches the vector DB until Update Vector DB.
- **Review workspace** — the rest of `/api/documents/<id>/workspace/*`: an
  older paragraph-by-paragraph editing API. The review screen does not use it.

This page covers the results and review workspace groups. Client wrapper:
`src/services/documentService.js`. The results responses have matching samples
in `src/services/fixtures/`, so those screens can be built before the backend
is up.

## Conventions

**Base URL.** In development the backend runs on `http://127.0.0.1:8000` and
Vite proxies `/api` to it (`vite.config.js`). Call the **relative** path —
`/api/documents/` — so the request is same-origin, the session cookie is sent,
and there is no CORS to configure. `documentService.js` falls back to the
absolute URL if the proxy is not running.

**Auth.** Two mechanisms, and they are not interchangeable:

- **Review workspace** — a login token. `POST /api/auth/login/` with
  `{ "email", "password", "remember_me" }` returns `{ "token", "user" }`;
  `authService.js` stores the token in `localStorage` under `clausewright_token`.
  Every workspace call must send `Authorization: Bearer <token>`, or it gets
  `401`. `documentService.js` adds the header to every request when a token is
  stored. This is also why a workspace URL typed into the browser's address bar
  only ever shows a `401`: the address bar cannot send the header.
- **Results** — no check today. Send the token anyway; they will check it.

**Errors.** Always JSON, always the same shape, always a real status code:

```json
{ "detail": "No document with that id." }
```

| status | means |
|---|---|
| `400` | a bad query parameter or body — `detail` says which; some add `allowed` |
| `401` | workspace call with no token, an unknown token, or an expired session — send the user to login |
| `403` | a workspace write without holding the document's lock — acquire it first |
| `404` | no document, paragraph or classification with that id, or no taxonomy at that version |
| `405` | wrong method |
| `409` | Save against a classification run that is no longer current — reload the document |
| `422` | publish refused — the body carries `blockers` |
| `423` | another reviewer holds the lock — open the document read-only |

**Nulls.** A stage that has not run is `null`, never an empty object or a zero.
Test `if (doc.stages.classification)`, not `.micro_chunks > 0`.

**Ids.** `document_id` and `classification_id` are UUIDs and are stable.
`clause_id` (`"c32"`) and `paragraph_id` (`"P-003"`) are *local* to one
extraction run — they tie the three views of a document together, but they are
not globally unique. Don't key a cache on them without the document id.

The workspace has its own `paragraph_id` (`"chunk_c14_micro"`): one per micro
chunk, unique within a document. Despite the name it is **not** the extraction
`paragraph_id` (`"P-003"`). Workspace edits are addressed by it.

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
          "classified_at": "2026-09-21T07:08:13+00:00",
          "review": { "reviewed": 41, "pending": 297, "accepted": 30,
                      "corrected": 9, "rejected": 2 }
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

`stages.classification.review` counts decisions made through the old review
routes, which are no longer wired, so today it is **always zero**. Don't build a
progress column on it. Review progress lives in the workspace (`progress`) and
in `GET /api/documents/stats/`.

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

**The review screen's data.** The current classification run: the model's
verdict on every item, plus what the reviewer has saved for it. Token required.

- `type` / `type_name` / `sub_type` / `label` are **always the model's answer**
  and never change.
- `final` is the item with the reviewer's saved decision applied. **Show
  `final`**, and send its values back on Save.
- `review` is the saved decision itself, or `null` while nobody has saved one.

| parameter | notes |
|---|---|
| `needs_review` | `true` returns only flagged items; the summary still counts the whole run |

```json
{
  "document": { "…": "…", "review_status": "in_review" },
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
    "by_type": { "Clause: Payment Terms": 24, "Clause: Confidentiality": 18 },
    "review": { "reviewed": 41, "pending": 297, "accepted": 30,
                "corrected": 9, "rejected": 2 }
  },
  "items": [
    {
      "classification_id": "8f2c1a94-4d21-4b07-9b60-2f3a6c5d1e77",
      "clause_id": "c32",
      "paragraph_ids": [141, 142],
      "number": "(a)",
      "breadcrumb": "2 SCOPE OF SERVICES > 2.3 The Service Provider shall… > (a) If the…",
      "lead_in": "The Service Provider shall install the System in Phases, and:",
      "text": "If the Service Provider delays Phases, then either the payments shall be postponed or…",
      "outcome": "classified",
      "label": "Clause",
      "type": "service-provider-obligations",
      "type_name": "Service Provider Obligations",
      "sub_type": "Installation Delay Consequences",
      "confidence": 0.82,
      "needs_review": true,
      "review_reasons": ["deviated"],
      "expected_types": ["scope-of-services"],
      "deviated": true,
      "error": null,
      "review": null,
      "final": {
        "label": "Clause", "type": "service-provider-obligations",
        "type_name": "Service Provider Obligations",
        "sub_type": "Installation Delay Consequences", "decision": null
      }
    }
  ],
  "access": { "user": { "id": "…", "username": "vamshi" }, "is_read_only": false,
              "locked_by": "vamshi", "locked_by_id": "…" },
  "vector_sync": { "pending_changes": 0, "last_synced_at": null },
  "filtered": { "needs_review": true, "returned": 97 }
}
```

- `classification_id` is the handle Save takes. It is stable; `clause_id` is not.
- `review` is `null` until someone saves a decision — the same not-yet rule as
  `stages`. Once saved:
  `{ review_id, revision, decision, label, type, type_name, sub_type, note,
  reviewed_by, reviewed_by_name, reviewed_at }`. An item is "saved" exactly
  when `review` is not `null`.
- `final` always has `label, type, type_name, sub_type, decision`. `decision`
  is `null` (nobody saved yet: the model's answer), `accepted` (the model's
  answer, confirmed), `corrected` (the reviewer's values) or `rejected`
  (`label`, `type` and `sub_type` all `null`).
- `lead_in` is the parent clause's own words, the sentence this item completes.
  Show it above the item: "describe the nature of the breach;" means little
  without "Processor shall notify Controller… Such notification shall as a
  minimum:". `null` for a top-level clause.
- `vector_sync.pending_changes` is how many saved items the vector DB does not
  have yet. Enable **Update Vector DB** when it is above `0`.
  `last_synced_at` is `null` until the first sync.
- `access.is_read_only` is `true` when you do not hold the lock: disable
  editing and Save.
- `summary.review` counts decisions over the whole run and is **never null**,
  only zeroed. A header can read "41 of 338 reviewed" straight from it, and it
  is unaffected by `needs_review=true`.
- `classification_run` is `null` when the document has not been classified.
  `summary` and `items` are then `null` / empty.
- `filtered` is present **only** when `needs_review=true` was passed.
- `items` is in reading order and has **one entry per micro chunk, always** —
  including the ones that failed. Coverage is provable; nothing drops silently.
- **`clause_id` numbers skip, and that is expected.** A clause whose own words
  are only a section heading (`c3` "RECITALS", `c28` "PERSONAL DATA BREACHES")
  has nothing to classify, so it gets no item; it is in the `breadcrumb` of
  every item under it. Every other clause has an item. That includes a parent
  whose own sentence says something ("Processor shall notify Controller without
  unreasonable delay… and shall:"): it has an item of its own, followed by
  items for its sub-clauses. Tables are in `text`, one row per line, with cells
  separated by ` | `.
- `type` / `type_name` are the canonical type; `sub_type` is the specific kind
  under it, which the model names (the taxonomy itself defines no sub-types).
- `breadcrumb` is the section trail the clause sits under.
- `paragraph_ids` are the source paragraphs the verdict covers, the same
  `paragraph_id` values `extraction(id)` returns. **Always an array**: a clause
  is regularly several paragraphs — about a fifth of them are — so do not read
  `paragraph_ids[0]` and treat it as the location. Use it to highlight the
  exact text behind a label without fetching the classification input.

### `outcome` — read this before rendering an item

| `outcome` | what it means | what is set |
|---|---|---|
| `classified` | got a type | `label`, `type`, `type_name`, `sub_type`, `confidence` |
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

## `POST /api/documents/<id>/classification/save/`

**The Save button.** Stores what the reviewer did to this document. Token and
lock required. Nothing is sent to the vector DB; Update Vector DB does that
later.

```json
{
  "classification_run_id": "5e60e15f-ed90-4bbe-9f20-4d689840b70f",
  "items": [
    { "classification_id": "a40d8ff0-…", "label": "Non-clause",
      "type": "party-identification", "sub_type": null },
    { "classification_id": "1a81e0b7-…", "label": "Clause",
      "type": "data-protection-and-privacy", "sub_type": "Data Retention" },
    { "classification_id": "bd0e59c2-…" },
    { "classification_id": "bed38e34-…", "decision": "rejected",
      "note": "Contact block, not a clause." }
  ]
}
```

What to send:

- **`classification_run_id`** — `classification_run.classification_run_id`
  from the GET you rendered.
- **`items`** — every row the reviewer **changed or ticked as verified** since
  the last Save, with the values the row shows now (`final.*` after any edits).
  Rows you leave out are not touched.
- **`type` is a taxonomy `key`** (`"data-protection-and-privacy"`), never the
  display name. Build the type dropdown from `GET /api/taxonomy/` and keep the
  `key`.
- **You don't send accepted or corrected.** The backend compares the values
  with the model's answer: the same means `accepted`, different means
  `corrected`. A row sent with only its `classification_id` means "verified as
  shown".
- **To reject**, send `"decision": "rejected"` with a `note`. Any other
  `decision` value is ignored.
- `sub_type`: `null`, `""` and `"null"` all mean none. A `Non-clause` never has
  one; it is dropped if sent.
- `note` is optional (required for a rejection).

`200`:

```json
{
  "saved": { "accepted": 1, "corrected": 2, "rejected": 1, "unchanged": 0 },
  "review_status": "in_review",
  "items": [ "…every row you sent, in exactly the GET item shape…" ],
  "summary": { "…the GET summary, review counts updated…" },
  "vector_sync": { "pending_changes": 4, "last_synced_at": null }
}
```

Replace your rows with `items` by `classification_id`, clear your list of
changed rows, and re-render the header from `summary` and the Update Vector
DB button from `vector_sync`. No refetch needed.

- **All or nothing.** If any row is wrong, nothing is saved:

  ```json
  { "detail": "1 item(s) could not be saved, so nothing was saved.",
    "errors": [ { "classification_id": "1a81e0b7-…",
                  "detail": "No type \"data-protection\" in taxonomy v1." } ] }
  ```

  Highlight each row named in `errors` and show its `detail`.
- **Saving twice is safe.** A row identical to its saved decision counts as
  `unchanged` and writes nothing.
- **Changing your mind is kept.** Saving a different value later replaces the
  decision in force; the earlier one stays in the history.
- `review_status` becomes `reviewed` once every item in the document has been
  saved (`reopened_reviewed` for a document published before), otherwise
  `in_review`.
- One `saved_review` event goes to the document timeline per Save that wrote
  something.

| status | when |
|---|---|
| `400` | bad body, a row that fails a check (`errors`), or a `classification_id` not in this document |
| `401` | no or expired token |
| `403` | you do not hold the lock |
| `409` | the document was re-classified after you loaded it. Body carries the current `classification_run_id`: reload |
| `423` | another reviewer holds the lock |

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

35 clause types, 11 non-clause types. An item's `type` matches a type's `key`,
and so does a workspace row's `canonical_type`; show `name`. `definition` is the
wording the classifier was given — good tooltip text, and the right thing to
show a reviewer deciding whether a verdict is fair.

---

## Review workspace

Every call in this group needs `Authorization: Bearer <token>` (see **Auth**);
every write also needs the document's lock.

### The flow the review screen uses

1. `GET /api/documents/queue/` → `needs_review` lists documents waiting for a
   first reviewer.
2. `POST .../workspace/lock/` → take the lock. `acquired: false` means someone
   else has it: open the document read-only.
3. `GET .../classification/` → the screen's data. Show `final`.
4. Every 60 s while the document is open: `POST .../workspace/lock/heartbeat/`.
   The lock expires 120 s after the last renewal.
5. Edits stay in the browser; remember which rows were changed or verified.
6. Save → `POST .../classification/save/` with those rows.
7. Update Vector DB → only once Save has left something pending
   (`vector_sync.pending_changes > 0`).
8. On leaving: `POST .../workspace/lock/release/`.

`...` is `/api/documents/<id>` throughout.

### The older workspace API

The endpoints below edit a workspace copy of each verdict one paragraph at a
time. **The review screen does not use them.** A Save through
`/classification/save/` keeps those rows up to date itself, because Update
Vector DB reads them. Their docs are kept for reference.

## `GET /api/documents/<id>/workspace/`

```json
{
  "document_id": "01936efc-24d7-460f-b9de-29bd4241e36c",
  "review_status": "in_review",
  "is_read_only": false,
  "lock": { "locked_by": "srikar", "locked_by_id": "7c1e…", "locked_at": "…",
            "expires_at": "…", "is_yours": true },
  "progress": { "reviewed": 12, "total": 83 },
  "blockers": ["71 paragraph(s) still to review"],
  "paragraphs": [
    {
      "paragraph_id": "chunk_c2_micro",
      "sequence_order": 1,
      "breadcrumb": ["1 WATER PURCHASE", "A Buyer shall purchase from the Seller and pay the..."],
      "source_page": 1,
      "original_text": "…",
      "reviewed_text": "…",
      "label": "Clause",
      "canonical_type": "purpose-and-scope-of-services",
      "sub_type": "Water Purchase Obligation",
      "confidence": 0.75,
      "llm_issues": ["low_confidence"],
      "is_reviewed": false,
      "is_modified": false,
      "reviewed_by_id": null,
      "last_edited_by_id": null,
      "last_edited_at": null
    }
  ],
  "draft": null,
  "last_vector_sync": { "records": 0, "synced_at": null }
}
```

| top-level field | meaning |
|---|---|
| `review_status` | where the document is in review — see **Review status** below |
| `is_read_only` | `true` when another reviewer holds the lock; disable every edit control |
| `lock` | who holds the lock, or `null` when nobody does. `is_yours` says whether it is you |
| `progress` | rows marked reviewed, out of all rows — the "12 of 83" header |
| `blockers` | why publishing would be refused right now; empty means it can publish |
| `paragraphs` | one row per micro chunk, in reading order |
| `draft` | `{ exists, seconds_remaining, updated_at }` when you have an autosave draft, else `null` |
| `last_vector_sync` | when the document was last published to the vector store |

**Each row in `paragraphs`:**

| field | type | meaning |
|---|---|---|
| `paragraph_id` | string | the row's id, `chunk_<clause_id>_micro`. Edits are addressed by it |
| `sequence_order` | int | reading order; the list already comes sorted by it |
| `breadcrumb` | string[] | the section trail the clause sits under, outermost first |
| `original_text` | string | the text as extracted. Never changes |
| `reviewed_text` | string | the editable copy. Starts equal to `original_text` |
| `label` | `"Clause"` \| `"Non-clause"` | |
| `canonical_type` | string | the type's `key` from `/api/taxonomy/` (show its `name`), or `""` when there is none |
| `sub_type` | string | the specific kind under the type, in the model's words. `""` for a Non-clause |
| `confidence` | number \| null | the model's own 0–1 estimate that label and type are right. `null` = no answer |
| `llm_issues` | string[] | why the row needs a human — see below. Empty = nothing flagged |
| `is_reviewed` | bool | a reviewer has ticked the row |
| `is_modified` | bool | a reviewer changed its text, type or label |
| `reviewed_by_id` / `last_edited_by_id` | UUID \| null | user ids; `last_edited_at` is when |
| `source_page` | int | **always `1` today — don't show it** |

### `llm_issues` — why a row needs a human

The same values as `review_reasons` on `/classification/`. The name is
misleading: the backend computes them, the model does not report them.

| value | meaning |
|---|---|
| `low_confidence` | `confidence` is below 0.85 |
| `high_risk` | the type is `indemnification`, `limitation-of-liability` or `intellectual-property`; always reviewed |
| `deviated` | the type is not one the section heading implied |
| `unclassified` | a real clause that fits no type |
| `failed` | the model never returned a usable answer |

There is no `needs_review` flag on a row, and the endpoint ignores
`?needs_review=`. "Needs review" is `llm_issues.length > 0` — filter client-side.

### Classified, unclassified, failed

A row does not carry the classification's `outcome`. Tell them apart like this:

| what the row shows | means |
|---|---|
| `canonical_type` set | classified |
| `label: "Clause"`, `canonical_type: ""`, `llm_issues` has `unclassified` | a real clause no type fits; the reviewer picks one |
| `label: "Clause"`, `canonical_type: ""`, `confidence: null`, `llm_issues` has `failed` | no answer from the model. `"Clause"` is a placeholder here, not a verdict |

Both empty-type cases block publishing until a reviewer sets a type.

## Lock

`POST .../workspace/lock/`

```json
{ "acquired": true, "is_read_only": false, "expires_at": "…", "review_status": "in_review" }
```

Taking the lock moves `needs_review` → `in_review`, and `published` →
`reopened_in_review`. When someone else holds it the answer is still `200`:

```json
{ "acquired": false, "is_read_only": true, "locked_by": "anna", "locked_by_id": "…", "expires_at": "…" }
```

- `POST .../workspace/lock/heartbeat/` → `{ "expires_at": "…" }`. Send every
  60 s; `403` if you no longer hold the lock.
- `POST .../workspace/lock/release/` → `{ "released": true }`.

A write without the lock is refused with `403`; a write while someone else holds
it with `423`.

## `POST /api/documents/<id>/workspace/paragraphs/<paragraph_id>/`

Edit one row. Send only the fields that changed:

```json
{
  "reviewed_text": "…",
  "label": "Clause",
  "canonical_type": "fees-and-payment",
  "sub_type": "Late Payment Interest",
  "is_reviewed": true
}
```

| field | effect |
|---|---|
| `reviewed_text` | replaces the editable text |
| `label` | `Clause` or `Non-clause` |
| `canonical_type` | a type `key`, or `""` to clear it |
| `sub_type` | free text |
| `is_reviewed` | `true` ticks the row and records you as reviewer; `false` unticks it |

**→ `{ "paragraph_id": "chunk_c2_micro", "updated": true }`** — not the row.
Apply what you sent to local state, or refetch the workspace.

**The backend stores these values as sent, without checking them.** The
frontend has to:

- send a `canonical_type` that is a `key` from `/api/taxonomy/`: from
  `clause_types` when the row's label is `Clause`, from `non_clause_types` when
  it is `Non-clause`;
- send `sub_type: ""` together with `label: "Non-clause"` — a Non-clause has no
  sub-type;
- send `label` as exactly `Clause` or `Non-clause`.

## `POST /api/documents/<id>/workspace/bulk-update/`

The same change on many rows — "mark all visible as reviewed".

```json
{ "paragraph_ids": ["chunk_c2_micro", "chunk_c3_micro"], "is_reviewed": true }
```

`paragraph_ids` is required. Also takes `is_reviewed`, `label` and
`canonical_type` (not text or `sub_type`). **→ `{ "updated": 2 }`.** Ids that
do not exist are skipped without an error, so compare `updated` with the number
you sent.

## Draft (autosave)

- `POST .../workspace/draft/` with `{ "payload": [ … ] }` →
  `{ "draft_id", "expires_at", "seconds_remaining", "created" }`. Sets
  `review_status` to `draft`. A draft expires 24 h after it was last saved.
- `DELETE .../workspace/draft/discard/` → `{ "discarded": true }`; `404` when
  there is no draft. Note the path ends in `discard/` and the method is `DELETE`.

The workspace only reports that a draft **exists**; it does not return the
payload, so a draft cannot be restored from the server today. Row edits are
saved as they are made, so no edit depends on the draft.

## `POST /api/documents/<id>/workspace/save/`

```json
{ "saved": true, "review_status": "reviewed", "progress": { "reviewed": 83, "total": 83 } }
```

Writes no rows — they were saved as they were edited. It deletes your draft and
moves the status: `reviewed` when every row is reviewed, otherwise `in_review`
(`reopened_reviewed` / `reopened_in_review` for a document that was published
before).

## `POST /api/documents/<id>/workspace/publish/`

Refused with `422` while anything blocks it:

```json
{ "can_publish": false, "blockers": ["3 paragraph(s) missing canonical type"] }
```

Otherwise queued: `{ "queued": true, "task_id": "…", "message": "…" }`. The
background worker embeds the rows and sets the document `published`.

A document is blocked while any row is not reviewed, any `Clause` row has no
`canonical_type`, or any row's `reviewed_text` is empty. The workspace returns
the same `blockers` list, so the publish button can be disabled up front.

## Review status

| `review_status` | means |
|---|---|
| `pending_classification` | still in the pipeline |
| `needs_review` | classified, nobody has opened it |
| `in_review` | a reviewer has taken the lock |
| `draft` | a reviewer saved an autosave draft |
| `reviewed` | every row reviewed and saved |
| `published` | published to the vector store |
| `reopened_in_review` | opened again after publishing |
| `reopened_reviewed` | reviewed again after reopening |

## Around the workspace

All need the token.

| call | returns |
|---|---|
| `GET /api/documents/queue/` | `{ in_flight, needs_review, unprocessable }`: still in the pipeline, waiting for a first reviewer, refused by the parser |
| `GET /api/documents/stats/` | `{ counts: { <review_status>: n } }` |
| `GET .../activity/` | the document's timeline in five phases, each with its `events` |
| `GET .../contributors/` | who worked on the document, with event counts |
| `GET` / `POST .../note/` | one shared free-text note per document, `{ text, updated_at }` |
| `GET /api/activity/calendar/` | `{ days: [{ date, count }] }` across all documents |

### The document timeline

`GET /api/documents/<id>/activity/` (token required; 404 for an unknown id)

```json
{
  "document_id": "<uuid>",
  "phases": [
    { "phase": "data_ingestion", "label": "Data Ingestion",
      "events": [
        { "id": "<uuid>", "action": "drive_discovered",
          "summary": "Found \"msa.docx\" in Google Drive.",
          "actor": "Drive Sync", "metadata": { ... },
          "created_at": "2026-09-28T11:13:16.221000+00:00" }
      ] },
    { "phase": "data_staging", ... },
    { "phase": "data_parsing", ... },
    { "phase": "data_classification", ... },
    { "phase": "user_interaction", ... }
  ]
}
```

Always all five phases, in this order; a phase with nothing yet has
`events: []`. Events inside a phase are oldest first. Show `summary` as the
line of text and `actor` as who did it (a reviewer's username, or a system
label); `metadata` holds the numbers behind the summary. Events are never
edited or deleted.

Pipeline events, in the order a document meets them:

| phase | action | actor | metadata |
|---|---|---|---|
| `data_ingestion` | `drive_discovered` | Drive Sync | `drive_file_id, file_name, mime_type, size_bytes, folder_id, drive_modified_time` |
| `data_staging` | `download_staged` | Parser | `extraction_run_id, drive_file_id, size_bytes, mime_type, content_sha256, download_ms` |
| `data_parsing` | `parsing_started` | Parser | `drive_file_id, parser_build` |
| `data_parsing` | `parsed` | Parser | `extraction_run_id, attempt, status, parser_build, clauses, paragraphs, page_count, warnings, warning_codes, parse_ms, persist_ms` |
| `data_parsing` | `parsing_skipped` | Parser | `extraction_run_id, attempt` (file unchanged, nothing re-written) |
| `data_parsing` | `parsing_rejected` | Parser | `extraction_run_id, attempt, status, parser_build, reason, detected_format, remedy` (not a .docx, too large, ...) |
| `data_parsing` | `parsing_failed` | Parser | `reason`, plus either `error` (Drive or database error) or the `parsing_rejected` fields |
| `data_parsing` | `chunking_started` | Chunker | `extraction_run_id, attempt, chunker_version` |
| `data_parsing` | `chunked` | Chunker | `chunk_run_id, extraction_run_id, attempt, chunker_version, chunks, micro_chunks, macro_chunks, indexed_chunks, token_estimate, complete, clauses_unreachable, paragraphs_missing, duration_ms` |
| `data_classification` | `classifying_started` | LLM Classifier | `classification_run_id, attempt, model_id, taxonomy_version, prompt_version, micro_chunks` |
| `data_classification` | `classified` | LLM Classifier | `classification_run_id, attempt, status, model_id, taxonomy_version, prompt_version, calls, prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens, micro_chunks, classified, unclassified, failed, needs_review, avg_confidence, low_confidence, confidence_threshold, duration_ms` |
| `data_classification` | `classification_failed` | LLM Classifier | same as `classified`, plus `reason` |
| `data_classification` | `moved_to_review_queue` | Pipeline | `classification_run_id, paragraphs, needs_review, blockers_count, blockers` |

Chunking has no phase of its own and sits under `data_parsing`.
`token_estimate` is characters / 4 over the micro chunks, the figure the
classifier batches by, not a billed count. A document re-parsed or
re-classified later gets a second set of these events; the ids in `metadata`
tell the passes apart.

`user_interaction` holds the reviewer's events: `acquired_lock`,
`released_lock`, `modified_paragraph_text`, `changed_canonical_type`,
`marked_paragraphs_reviewed`, `saved_draft`, `discarded_draft`,
`draft_expired`, `saved_review`, `published_to_vector_db`.

---

## Building the review screen

1. Log in → `authService` stores the token; `documentService` sends it from then on.
2. `documentService.taxonomy()` once at app start → a `key` → `name` map for
   display and for the type dropdown (split by `clause_types` /
   `non_clause_types`, since the label decides which list applies), with
   `definition` tooltips. Keep the `key`; Save sends it.
3. The list → `GET /api/documents/queue/` for what is waiting, or
   `documentService.list({ classified: true })` for everything classified.
4. Opening a document → take the lock, then `documentService.classification(id)`.
   Render `items` in order. Show `final.label` / `final.type_name` /
   `final.sub_type`, and `lead_in` above an item that has one. An item with
   `review !== null` is saved. Everything read-only when `access.is_read_only`.
5. Heartbeat every 60 s while open; release on close.
6. "Only what needs review" → `?needs_review=true`, or filter on `needs_review`.
7. Edits and ticks change local state only. Keep a set of changed
   `classification_id`s.
8. Save → `POST .../classification/save/` with `classification_run_id` and one
   entry per changed id: `{ classification_id, label, type, sub_type }` from the
   row's current values. Swap the returned `items` in and clear the set. On
   `400`, mark the rows in `errors`. On `409`, reload.
9. Update Vector DB → enabled while `vector_sync.pending_changes > 0`.

## What is not here yet

- **The old review routes.** `POST /api/classifications/<id>/review/`,
  `GET /api/classifications/<id>/review/history/` and
  `POST /api/documents/<id>/reviews/` have views but are not in `urls.py`, so
  they return `404`. Save (`/classification/save/`) replaces them; don't use
  them.
- **Checking what a write sends.** The workspace stores `label`,
  `canonical_type` and `sub_type` as sent; the checks above are on the frontend
  for now.
- **The updated row in a write's response.** Edits return only `updated`.
- **Restoring a draft.** Its payload is stored but never returned.
- **Page numbers.** `source_page` is always `1`.
- **Listing documents by review status.** `queue` lists only `needs_review`;
  `GET /api/documents/` has no `review_status` filter. Ask if a screen needs one.
- **Pagination inside a document.** `paragraphs` returns every row.
- **Triggering a run.** Parsing and classification start from the Drive sync
  and management commands, not from these endpoints.
- **Auth on the results endpoints.** Not checked yet; send the token anyway.
