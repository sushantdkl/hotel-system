/**
 * Browser-side fetch wrapper that attaches the POS bearer token.
 * Every admin page had its own copy of this; they all call this now.
 */

export function authedRequest(url, options = {}) {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('pos_token');
  const headers = { Authorization: `Bearer ${token}`, ...options.headers };
  // FormData must keep the browser-generated multipart boundary.
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

/** authedRequest + JSON parse, throwing the API's own error body on failure. */
export async function apiJson(url, options) {
  const res = await authedRequest(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(data, { status: res.status });
  return data;
}

/** Same, but hands the caller the status too (for the 409 "generated expense" path). */
export async function apiJsonRaw(url, options) {
  const res = await authedRequest(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
