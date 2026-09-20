/**
 * Error reporting.
 *
 * Every serious bug found in the August 2026 hardening pass was silent. The
 * credit heartbeat returned 500 on every request for months behind a bare
 * `.catch(() => {})`; the question status endpoint failed on every call while
 * the UI optimistically pretended otherwise. Nothing surfaced because nothing
 * was watching. This is the thing that watches.
 *
 * Inert without SENTRY_DSN, so local development and the test suites run
 * untouched and no key is required to work on the project.
 *
 * Deliberately narrow about what it reports. Only genuine server faults are
 * sent — never a 4xx. A client sending a malformed id or bad JSON is not an
 * incident, and three such paths existed today; reporting them would have made
 * the dashboard useless on the first day, which is exactly how alerting gets
 * ignored.
 */

import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN ?? '';
export const sentryEnabled = Boolean(DSN);

export function initSentry(): void {
  if (!sentryEnabled) {
    console.log('[sentry] SENTRY_DSN not set — error reporting disabled.');
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'development',

    // Traces are a separate quota and a separate question from "is anything
    // broken". Off until there is a performance problem worth measuring.
    tracesSampleRate: 0,

    // Request bodies carry passwords on /auth/login and /auth/register, and
    // question text everywhere else. None of it belongs in an error tracker.
    sendDefaultPii: false,

    beforeSend(event) {
      // Belt and braces: strip anything that could carry a credential even if a
      // future integration starts attaching request data.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
        // The SSE endpoint carries a token in its query string.
        if (event.request.query_string) delete event.request.query_string;
      }
      return event;
    },
  });

  console.log('[sentry] error reporting enabled');
}

/**
 * Report a server fault.
 *
 * Called from the error handler's 500 branch only, so the decision about what
 * counts as an incident lives in one place next to the status code it reports.
 */
export function captureServerError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentryEnabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
