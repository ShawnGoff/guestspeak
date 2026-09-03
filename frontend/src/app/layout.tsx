import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorker from '@/components/ServiceWorker';

// The canonical public address, used for metadataBase, the canonical URL and
// the Open Graph url. Overridable so preview deployments describe themselves
// rather than pointing every share card at production.
//
// This was pinned to the generated guestspeak-frontend.vercel.app hostname. Once
// that became a redirect to the real domain, every page still advertised it as
// canonical — telling search engines the site lives at a URL that immediately
// bounces, which is the damage moving to a real domain is meant to undo.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://guestspeak.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'GuestSpeak — Audience Q&A for events, broadcasts and shows',
    template: '%s — GuestSpeak',
  },
  description: 'Audience Q&A for live events, broadcasts and shows. Your audience submits questions and adds Echoes to the ones they want answered most — live, or ahead of time. No account required.',
  keywords: ['live Q&A', 'audience questions', 'event Q&A', 'conference Q&A', 'live events'],
  authors: [{ name: 'GuestSpeak', url: SITE_URL }],
  openGraph: {
    type: 'website',
    siteName: 'GuestSpeak',
    title: 'GuestSpeak — Live Q&A for events',
    description: 'Audience Q&A for live events, broadcasts and shows. No account required.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GuestSpeak — Live Q&A for events',
    description: 'Audience Q&A for live events, broadcasts and shows. No account required.',
  },
  robots: {
    index: true,
    follow: true,
  },
  // iOS does not read the web app manifest for these. Without them an installed
  // GuestSpeak opens in a Safari chrome rather than standalone, and shows the
  // wrong icon on the Home Screen.
  appleWebApp: {
    capable: true,
    title: 'GuestSpeak',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // Declaring `icons` at all overrides Next's app/icon.svg file convention,
    // so naming only `apple` left the page with no <link rel="icon"> and
    // browsers fell back to /favicon.ico, which does not exist. The icon was
    // there and served the whole time; nothing pointed at it.
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#1A0A2E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Warm both origins before anything asks them for a file. Google
            serves the CSS from one host and the font files from another, so
            without these the browser pays two fresh DNS+TLS handshakes back to
            back, at the point where it is already blocked on rendering. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:wght@700;800&display=swap"
        />
      </head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
