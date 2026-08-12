'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker.
 *
 * Mounted once from the root layout. Registration is deliberately quiet — a
 * failure here costs installability and push, not the app itself, so it must
 * never surface as an error to someone just trying to ask a question.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Registering during load contends with the page's own requests, which
    // matters most on the venue wifi this app is used on.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed:', err);
      });
    };

    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
