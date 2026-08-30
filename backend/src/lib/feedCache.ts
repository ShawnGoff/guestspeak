/**
 * Short-TTL cache for the public question feed.
 *
 * At stadium scale the feed is read far more often than it changes: 60,000
 * attendees polling every few seconds is 60,000 identical queries against a
 * 20-connection pool. Caching the rendered feed for a couple of seconds turns
 * that into roughly one query per TTL per session, regardless of crowd size.
 *
 * Deliberately in-process, matching the SSE broadcaster. It is a read cache, so
 * a second replica does not break correctness the way the broadcaster would —
 * each replica simply keeps its own copy and both go stale by at most one TTL.
 *
 * Only the audience feed is cached. Host and moderator views are excluded
 * entirely: they include hidden and pending questions, and a moderator acting on
 * a question must see the result immediately, not up to a TTL later.
 */

import { envIntMin } from './env';

const DEFAULT_TTL_MS = envIntMin('FEED_CACHE_TTL_MS', 2000, 0);

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

/** Guards against unbounded growth if a server sees a very large number of sessions. */
const MAX_ENTRIES = 5_000;

export function cacheKey(sessionId: string, sort: string, limit: number, offset: number): string {
  return `${sessionId}:${sort}:${limit}:${offset}`;
}

export function getCached<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function setCached(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): void {
  if (store.size >= MAX_ENTRIES) evictExpired();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Drop every cached page for a session.
 *
 * Called when a moderator changes what the audience should see (hide, approve,
 * spotlight). Without this, hiding an abusive question would leave it visible to
 * pollers for up to one TTL — short, but the wrong thing to be slow about.
 */
export function invalidateSession(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.expiresAt) store.delete(key);
  }
  // Still full of live entries — drop the oldest insertions (Map preserves order).
  if (store.size >= MAX_ENTRIES) {
    const excess = store.size - Math.floor(MAX_ENTRIES / 2);
    let dropped = 0;
    for (const key of store.keys()) {
      if (dropped++ >= excess) break;
      store.delete(key);
    }
  }
}

