/**
 * Next's hook for wiring up observability before anything else runs.
 *
 * Loads whichever Sentry config matches the runtime. Both are inert without a
 * DSN, so local development and CI import them and do nothing.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/**
 * Server-side render errors. Without this, a component throwing during an App
 * Router render is swallowed into the error boundary and never reported.
 */
export { captureRequestError as onRequestError } from '@sentry/nextjs';
