'use client';

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
    // The boundary catches the error, so nothing else will report it. Sentry is
    // inert without a DSN, so this is a no-op locally and in CI.
    Sentry.captureException(error);
    console.error(error);
  }, [error]);

  return (
    <div className="relative min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4 text-center overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[250px] rounded-full bg-red-500/10 blur-[80px] pointer-events-none" />

      <div className="relative max-w-sm">
        <p className="text-5xl mb-4">⚠️</p>
        <h1 className="text-2xl font-bold text-white mb-3">Something went wrong</h1>
        <p className="text-purple-200/75 mb-8">
          An unexpected error occurred. If this keeps happening, let us know.
        </p>
        <button onClick={reset} className="btn-primary px-6 py-3 text-sm">
          Try again
        </button>
      </div>
    </div>
  );
}
