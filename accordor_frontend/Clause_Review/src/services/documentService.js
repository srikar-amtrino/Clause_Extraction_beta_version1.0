/**
 * Pipeline results service — what the backend extracted and classified.
 *
 * Every endpoint here is a GET and a pure read. None of them start a parse or a
 * classification run, so they are safe to call on mount, on focus, or on a poll.
 * Ingestion (connect Drive, pick folders, sync) stays in googleDriveService.js.
 *
 * - GET /api/documents/                             the document list + stage results
 * - GET /api/documents/<id>/                        one document and the runs it has
 * - GET /api/documents/<id>/classification/         the verdict and micro chunks for each clause
 *
 * Errors come back as { detail: "..." } with a real status code and are thrown
 * as an Error carrying that detail, so a catch block can show it directly.
 */

const BACKEND_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : 'http://127.0.0.1:8000';

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
};
