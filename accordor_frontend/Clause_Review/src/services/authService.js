/**
 * authService.js — Thin fetch wrapper for the auth API.
 *
 * Matches the style of documentService.js used elsewhere in the project.
 * Stores and reads the session token from localStorage under a single key.
 *
 * API base URL is read from the Vite env variable VITE_API_BASE_URL.
 * Falls back to '' (empty string), which makes fetch use the same origin —
 * fine for the Vite dev proxy and for a co-deployed production bundle.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const TOKEN_KEY = 'clausewright_token';
const USER_KEY = 'clausewright_user';

// ---------------------------------------------------------------------------
// Token & User storage helpers
// ---------------------------------------------------------------------------

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — best effort */
  }
}

export function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Internal fetch helper
// ---------------------------------------------------------------------------

/**
 * Make a JSON request to the auth API.
 *
 * @param {string} path   - e.g. '/api/auth/signup/'
 * @param {'GET'|'POST'} method
 * @param {object|null}  body  - will be JSON-stringified; omit for GET
 * @returns {Promise<object>} - parsed JSON body on success
 * @throws {Error} with `.message` set to the API's `detail` string on non-2xx
 */
async function request(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };

  const token = getStoredToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server error (${response.status})`);
  }

  if (!response.ok) {
    const message = data?.detail || `Request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign up a new user.
 *
 * @param {{ username: string, email: string, password: string, role: string, remember_me?: boolean }} payload
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function signup(payload) {
  const data = await request('/api/auth/signup/', 'POST', payload);
  // User must explicitly sign in through the login page
  return data;
}

/**
 * Log in with email and password.
 *
 * @param {{ email: string, password: string, remember_me?: boolean }} payload
 * @returns {Promise<{ token: string, user: object }>}
 */
export async function login(payload) {
  const data = await request('/api/auth/login/', 'POST', payload);
  storeToken(data.token);
  storeUser(data.user);
  return data;
}

/**
 * Log out the current session. Clears the stored token regardless of whether
 * the server call succeeds (network down → still clears local state).
 */
export async function logout() {
  try {
    await request('/api/auth/logout/', 'POST');
  } finally {
    clearStoredToken();
  }
}

/**
 * Fetch the current user's profile using the stored token.
 * Returns null if there is no token or the token is invalid / expired.
 *
 * @returns {Promise<object|null>}
 */
export async function me() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const data = await request('/api/auth/me/', 'GET');
    if (data.user) {
      storeUser(data.user);
    }
    return data.user ?? null;
  } catch (err) {
    if (err.status === 401) {
      clearStoredToken();
      return null;
    }
    throw err;
  }
}
