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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
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
    throw Object.assign(new Error(body.error ?? 'Request failed'), { status: res.status });
  }
  return res.json();
}

export const api = {
  get:    <T>(path: string)                      => request<T>(path),
  post:   <T>(path: string, body: unknown)       => request<T>(path, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(path: string, body: unknown)       => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string)                      => request<T>(path, { method: 'DELETE' }),
};

export function sseUrl(sessionId: string): string {
  const token = getToken();
  return `${API}/sessions/${sessionId}/stream${token ? `?token=${token}` : ''}`;
}
