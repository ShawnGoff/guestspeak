'use client';

/**
 * The last boundary. error.tsx only catches failures inside a route segment —
 * if the root layout itself throws, that one never mounts and nothing reports.
 *
 * This one replaces the whole document, which is why it renders its own <html>
 * and <body>. It is also the boundary Sentry needs to see React render errors
 * in the App Router; without it those were the one class of failure the browser
 * SDK still missed, and React render errors are exactly what this session kept
 * turning up.
 *
 * Deliberately plain: the root layout has already failed, so anything relying
 * on it — fonts, providers, the nav — cannot be assumed. Colours are inlined
 * rather than taken from Tailwind tokens for the same reason.
 */

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 1rem',
          textAlign: 'center',
          background: '#1A0A2E',
          color: '#F3F0FF',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: '24rem' }}>
          <p style={{ fontSize: '3rem', margin: '0 0 1rem' }}>⚠️</p>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: 'rgba(221, 214, 254, 0.75)', margin: '0 0 2rem', lineHeight: 1.6 }}>
            An unexpected error occurred. If this keeps happening, let us know.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0.75rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 700,
              color: '#fff',
              background: 'linear-gradient(135deg, #FFB74D 0%, #F5921E 60%, #E07010 100%)',
              border: 'none',
              borderRadius: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
