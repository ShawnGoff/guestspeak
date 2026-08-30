/**
 * Errors thrown while Next renders on the server.
 *
 * Distinct from the Express backend's Sentry: this catches failures in the
 * Next server itself — a server component throwing, a route handler blowing
 * up — which the API's reporter never sees.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // See the note in sentry.client.config.ts — a blank dashboard field is an
    // empty string, which `??` would keep.
    environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
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
