/* GuestSpeak service worker.
 *
 * Deliberately minimal. This is a live Q&A app: a stale question list is worse
 * than no question list, so nothing from the API is ever cached and no page
 * HTML is served from cache while the network is available.
 *
 * It exists for two reasons:
 *   1. installability — a fetch handler is required for the install prompt
 *   2. push notifications — which must be handled here, not on the page
 */

const VERSION = 'gs-v1';
const OFFLINE_URL = '/offline.html';

// Only the offline fallback is precached. Next.js fingerprints its own assets
// and Vercel serves them with long-lived immutable headers, so caching them
// again here would only add a second, staler copy to keep in sync.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Network-only, with an offline page for navigations.
 *
 * Anything else risks showing a stale feed during a live session — the one
 * moment being out of date actually matters.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  // Never touch the API. Credit balances, question lists and moderation state
  // are all live values.
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        // caches.match resolves to undefined when nothing matches, and
        // respondWith(undefined) is not a valid response — so a failed
        // navigation on a client whose offline page was never cached, or was
        // evicted, or was dropped by a version bump mid-install, produced a
        // navigation with no Response at all rather than the offline page.
        // Whatever the browser does with that, it is not what this handler was
        // written to do.
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? new Response(
          '<!doctype html><meta charset="utf-8">'
          + '<title>Offline — GuestSpeak</title>'
          + '<body style="font-family:system-ui;background:#1A0A2E;color:#F3F0FF;'
          + 'display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
          + '<div><p style="font-weight:700">Guest<span style="color:#F5921E">Speak</span></p>'
          + '<p>You are offline. This page will work again once you reconnect.</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }),
    );
  }
});

// ─── Push ────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'GuestSpeak', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'GuestSpeak';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/maskable-192.png',
    // Collapse repeat notifications for the same session rather than stacking
    // one per event — a busy room would otherwise bury the phone.
    tag: payload.tag || 'guestspeak',
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  // Focus an existing tab if one is already on the target, rather than opening
  // a duplicate window every time a notification is tapped.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
