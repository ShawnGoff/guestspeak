/**
 * Browser error reporting.
 *
 * The backend has had Sentry for a while; the browser had nothing but a
 * `// Log to your error reporting service here` comment in error.tsx. That gap
 * mattered more than it looked, because the browser is where the bugs were:
 * the featured card handing one question's draft to another, the credits label
 * hidden on phones, hosts locked out of echoing. Every one was found by a
 * person using the product on a real phone, and that does not scale past one
 * person on one device.
 *
 * Mirrors backend/src/lib/sentry.ts on purpose — inert without a DSN, traces
 * off, and nothing sensitive leaves the browser.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? 'development',

    // Same call as the server: a separate quota answering a separate question.
    tracesSampleRate: 0,

    // Session Replay records what the user saw. On this product that is the
    // question feed — other people's questions, names and, in a private
    // session, the entire contents. Off.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    sendDefaultPii: false,

    // A phone on a train drops connections constantly. Those are not bugs, and
    // left in they would bury the ones that are.
    ignoreErrors: [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource',
      'Load failed',
      'AbortError',
      // Fired when a background tab is discarded mid-request.
      'The operation was aborted',
      // Browser extensions injecting into the page — not ours to fix.
      'ResizeObserver loop completed with undelivered notifications',
      'ResizeObserver loop limit exceeded',
    ],

    beforeBreadcrumb(breadcrumb) {
      // Fetch/XHR breadcrumbs carry full URLs, and the SSE endpoint puts a
      // token in its query string.
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        const url = breadcrumb.data?.url;
        if (typeof url === 'string' && url.includes('?')) {
          breadcrumb.data = { ...breadcrumb.data, url: url.split('?')[0] };
        }
      }
      // Console breadcrumbs replay whatever the app logged, which on this
      // codebase includes feed payloads.
      if (breadcrumb.category === 'console') return null;
      return breadcrumb;
    },

    beforeSend(event) {
      // Belt and braces, matching the server: strip anything that could carry a
      // credential if a future integration starts attaching request data.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        if (event.request.query_string) delete event.request.query_string;
      }
      return event;
    },
  });
}
