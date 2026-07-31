// NEXT_PUBLIC_API_URL should be the base domain only, e.g. https://api.guestspeak.app
// The /api prefix is appended here so all callers stay consistent.
const API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api';

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
    if (res.status === 401) {
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
