import type { MetadataRoute } from 'next';

/**
 * Web app manifest — served by Next at /manifest.webmanifest.
 *
 * This is what makes GuestSpeak installable to a home screen without going near
 * an app store. On iOS it is also the precondition for web push: notifications
 * only work once the site has been added to the Home Screen (iOS 16.4+).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GuestSpeak — Live Q&A for events',
    short_name: 'GuestSpeak',
    description:
      'Real-time audience Q&A for live events. Ask questions, Echo the ones you want answered most.',

    // start_url is the dashboard rather than the marketing home page: someone
    // who installed this is a returning host, not a first-time visitor.
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',

    background_color: '#1A0A2E',
    theme_color: '#1A0A2E',

    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops icons to a circle; these are padded so the bubble survives.
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],

    shortcuts: [
      {
        name: 'Join with a code',
        short_name: 'Join',
        description: 'Enter a session join code',
        url: '/?join=1',
      },
      {
        name: 'Discover sessions',
        short_name: 'Discover',
        description: 'Find live sessions near you',
        url: '/discover',
      },
    ],

    categories: ['productivity', 'business', 'social'],
  };
}
