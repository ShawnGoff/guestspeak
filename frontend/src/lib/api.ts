// NEXT_PUBLIC_API_URL should be the base domain only, e.g. https://api.guestspeak.app
// The /api prefix is appended here so all callers stay consistent.
const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const API = BACKEND + '/api';

/**
 * Resolves a backend asset path to a full URL.
 * Handles both legacy absolute URLs (http://localhost:3001/uploads/…)
 * and new relative paths (/uploads/…) stored after the URL-bug fix.
 */
export function resolveAsset(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http')) return url; // already absolute (legacy rows)
  return `${BACKEND}${url}`;             // relative path → prepend backend base
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('aa_token');
}

/**
 * Records every failed API call.
 *
 * Callers routinely swallow rejections — `.catch(() => {})` on a background
 * refresh is often the right call for the UI, since one failed poll should not
 * blow up the page. But swallowing it at the call site meant the failure left no
 * trace anywhere: the credit heartbeat returned 500 on every request for months
 * behind a bare catch, and nobody could have known.
 *
 * Logging here separates the two concerns. The UI still degrades quietly; the
 * failure is still visible. This is also the single place to forward errors to
 * a monitoring service when one is added — the call sites need not change again.
 */
function reportFailure(method: string, path: string, status: number, message?: string) {
  const line = `[api] ${method} ${path} -> ${status}${message ? `: ${message}` : ''}`;
  if (status >= 500 || status === 0) console.error(line);
  else console.warn(line);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const method = init?.method ?? 'GET';

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    // The request never completed — offline, DNS, CORS, connection refused.
    // There is no status to inspect, so this would otherwise vanish entirely.
    reportFailure(method, path, 0, err instanceof Error ? err.message : String(err));
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));

    // Only treat a 401 as "your session expired" when we actually sent a token.
    // Without this guard, a 401 on a request that was never authenticated in the
    // first place also cleared storage and bounced to /login — which is exactly
    // what happened to first-time guests: landing on a session fired the credit
    // heartbeat before they had a token, and the resulting 401 redirected them
    // away from the page before they could even pick a display name.
    if (res.status === 401 && token) {
      // Token expired or invalid — clear auth and redirect to login
      localStorage.removeItem('aa_token');
      localStorage.removeItem('aa_user');
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    }

    reportFailure(method, path, res.status, body.error);
    throw Object.assign(new Error(body.error ?? 'Request failed'), { status: res.status });
  }
  return res.json();
}

export const api = {
  get:    <T>(path: string)                      => request<T>(path),
  post:   <T>(path: string, body: unknown)       => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown)       => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // DELETE takes an optional body — account deletion confirms with a password,
  // which must not travel in the query string.
  delete: <T>(path: string, body?: unknown)      =>
    request<T>(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
};

export function sseUrl(sessionId: string): string {
  const token = getToken();
  return `${API}/sessions/${sessionId}/stream${token ? `?token=${token}` : ''}`;
}
