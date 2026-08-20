// Auth helpers — token storage and user session

export interface AuthUser {
  id: string;
  email?: string;
  username?: string;
  is_guest: boolean;
}

const TOKEN_KEY = 'aa_token';
const USER_KEY  = 'aa_user';

export function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoggedIn(): boolean {
  return !!getToken() && !!getUser();
}

export function isGuest(): boolean {
  return getUser()?.is_guest === true;
}

/**
 * A `?next=` destination that is safe to navigate to.
 *
 * The value arrives from the query string, so it is attacker-controlled: a link
 * to /login?next=https://example.invalid sends someone who signs in on the real
 * site straight to somebody else's, having just typed their password. Only
 * same-origin paths are allowed through, and anything else falls back.
 *
 * "Starts with a slash" is not enough on its own — //evil.example is
 * protocol-relative and /\evil.example is normalised to the same thing by some
 * browsers. Both are rejected.
 */
export function safeNext(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback;
  if (raw[0] !== '/') return fallback;
  if (raw[1] === '/' || raw[1] === '\\') return fallback;
  return raw;
}
