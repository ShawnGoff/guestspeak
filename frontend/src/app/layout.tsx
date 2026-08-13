import type { Metadata, Viewport } from 'next';
import './globals.css';
import ServiceWorker from '@/components/ServiceWorker';

const SITE_URL = 'https://guestspeak-frontend.vercel.app';

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
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
