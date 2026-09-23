/**
 * Pipeline results service — what the backend extracted and classified.
 *
 * Every endpoint here is a GET and a pure read. None of them start a parse or a
 * classification run, so they are safe to call on mount, on focus, or on a poll.
 * Ingestion (connect Drive, pick folders, sync) stays in googleDriveService.js.
 *
 * - GET /api/documents/                             the document list + stage results
 * - GET /api/documents/<id>/                        one document and the runs it has
 * - GET /api/documents/<id>/extraction/             clauses + paragraphs as stored
 * - GET /api/documents/<id>/classification-input/   micro chunks as the classifier reads them
 * - GET /api/documents/<id>/classification/         the verdict on each micro chunk
 * - GET /api/taxonomy/                              the clause types a verdict can use
 *
 * One group writes: a reviewer's decision about a verdict. These never touch
 * the classification itself -- the run stays an audit record -- and both
 * return items in exactly the shape `classification()` returns, so a decided
 * row can be swapped straight into state without refetching.
 *
 * - POST /api/classifications/<id>/review/          decide one verdict
 * - GET  /api/classifications/<id>/review/history/  every decision ever made on it
 * - POST /api/documents/<id>/reviews/               decide many at once, all or nothing
 *
 * Errors come back as { detail: "..." } with a real status code and are thrown
 * as an Error carrying that detail, so a catch block can show it directly.
 */

const BACKEND_BASE = 'http://127.0.0.1:8000';

/**
 * One fetch for every call below.
 *
 * Tries the relative path first so the Vite proxy in vite.config.js handles it
 * (same origin, so the session cookie is sent and there is no CORS to
 * configure), and falls back to the backend directly if the proxy is not there
 * — the same two-step googleDriveService.js uses.
 */
async function request(path, { params, method = 'GET', body } = {}) {
  const query = params ? `?${params}` : '';
  const options = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response = await fetch(`${path}${query}`, options).catch(() => null);
  if (!response || response.status === 404) {
    // 404 here can mean "the proxy is not running", not "no such document";
    // the direct call below tells the two apart. Safe to repeat even for a
    // POST: a 404 means the request reached nothing, so nothing was written.
    const direct = await fetch(`${BACKEND_BASE}${path}${query}`, options).catch(() => null);
    if (direct) response = direct;
  }
  if (!response) {
    throw new Error('Could not reach the backend. Is it running on port 8000?');
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.detail || `Request failed with status ${response.status}`);
  }
  return response.json();
}

/** Reads. Kept as its own name because every call below but the writes is one. */
function get(path, params) {
  return request(path, { params });
}

function post(path, body) {
  return request(path, { method: 'POST', body });
}

/** Turn a filter object into a query string, repeating array values. */
function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else {
      params.append(key, value);
    }
  });
  return params.toString();
}

export const documentService = {
  /**
   * The document list, newest first.
   *
   * All filters optional and combinable:
   *   folderIds  string[]  Drive folder the file was found in
   *   status     string[]  pending | extracted | extracted_with_warnings | rejected | failed
   *   classified boolean   whether a current classification run exists
   *   q          string    substring of the file name
   *   limit      number    defaults to 50, caps at 200
   *   offset     number
   *
   * -> { documents: [...], page: { total, limit, offset, returned, has_more } }
   *
   * Each row carries `stages.extraction` and `stages.classification` (null when
   * that stage has not run) and a `links` object — follow those rather than
   * building detail URLs by hand.
   */
  list({ folderIds, status, classified, q, limit, offset } = {}) {
    return get('/api/documents/', toQuery({
      folder_id: folderIds,
      status,
      classified,
      q,
      limit,
      offset,
    }));
  },

  /** One document and the state of its stages — the same row `list` returns. */
  get(documentId) {
    return get(`/api/documents/${documentId}/`);
  },

  /**
   * The current extraction run: clauses in reading order, then paragraphs.
   * `extraction` is null when the document has not been parsed.
   */
  extraction(documentId) {
    return get(`/api/documents/${documentId}/extraction/`);
  },

  /**
   * The micro chunks grouped by section, exactly as the classifier batches
   * them. Use this to show what the model was shown when explaining a verdict.
   * `chunk_run` is null when the document has not been chunked.
   */
  classificationInput(documentId) {
    return get(`/api/documents/${documentId}/classification-input/`);
  },

  /**
   * The current classification run: `summary` plus one `items` entry per micro
   * chunk (label, type, sub_type, confidence, reason, needs_review).
   * `classification_run` is null when the document has not been classified.
   *
   * Pass { needsReview: true } for the review queue. The summary still counts
   * the whole run, so a header can read "97 of 338 need review".
   */
  classification(documentId, { needsReview } = {}) {
    return get(`/api/documents/${documentId}/classification/`,
      toQuery({ needs_review: needsReview }));
  },

  /**
   * The workspace endpoint for the document: returns clauses, micro chunks,
   * heading trails, labels, type names, and sub types.
   */
  workspace(documentId, { needsReview } = {}) {
    return get(`/api/documents/${documentId}/workspace/`,
      toQuery({ needs_review: needsReview }));
  },

  /**
   * The clause types a verdict can carry, for filter menus and legends.
   * -> { version, clause_types: [...], non_clause_types: [...] }
   *
   * An item's `type` in a classification response matches a type's `key` here;
   * show `name`. Fetch once and cache — it changes only with a new taxonomy.
   */
  taxonomy({ version, includeInactive } = {}) {
    return get('/api/taxonomy/', toQuery({
      version,
      include_inactive: includeInactive,
    }));
  },

  /**
   * Record a reviewer's decision about one verdict.
   *
   *   decision  'accepted' | 'corrected' | 'rejected'
   *   type      taxonomy key -- required for 'corrected', omit otherwise
   *   label     'Clause' | 'Non-clause' -- optional, defaults to the verdict's
   *   subType   optional, and never on a Non-clause
   *   note      optional; required for 'rejected'
   *
   * -> the updated item, in the same shape `classification()` returns in
   * `items`. Swap it into state; there is no need to refetch the document.
   *
   * The reviewer is taken from the Drive session on the backend, so there is
   * nothing to send about who is deciding. Deciding again supersedes the
   * previous decision and keeps it in the history.
   */
  review(classificationId, { decision, type, label, subType, note } = {}) {
    return post(`/api/classifications/${classificationId}/review/`, {
      decision,
      type,
      label,
      sub_type: subType,
      note,
    });
  },

  /**
   * Every decision ever made about one verdict, newest first.
   * -> { classification_id, reviews: [{ revision, decision, is_current, ... }] }
   */
  reviewHistory(classificationId) {
    return get(`/api/classifications/${classificationId}/review/history/`);
  },

  /**
   * Decide several verdicts for one document at once -- the "accept everything
   * visible" button. Each entry takes the same fields as `review`, plus the
   * `classificationId` it applies to.
   *
   * All or nothing: if one entry is bad, nothing is written and the thrown
   * Error says which. -> { updated, items, summary }, where `items` holds only
   * the rows that changed and `summary` covers the whole run, so a header can
   * be re-rendered from the one response.
   */
  reviewMany(documentId, decisions = []) {
    return post(`/api/documents/${documentId}/reviews/`, {
      decisions: decisions.map(({ classificationId, decision, type, label, subType, note }) => ({
        classification_id: classificationId,
        decision,
        type,
        label,
        sub_type: subType,
        note,
      })),
    });
  },
};
