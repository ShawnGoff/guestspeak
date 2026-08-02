import type { Metadata, Viewport } from 'next';
import './globals.css';

const SITE_URL = 'https://guestspeak-frontend.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'GuestSpeak — Live Q&A for events',
    template: '%s — GuestSpeak',
  },
  description: 'Real-time audience Q&A for live events. Submit questions, add Echoes to the ones you want answered most. No account required.',
  keywords: ['live Q&A', 'audience questions', 'event Q&A', 'conference Q&A', 'live events'],
  authors: [{ name: 'GuestSpeak', url: SITE_URL }],
  openGraph: {
    type: 'website',
    siteName: 'GuestSpeak',
    title: 'GuestSpeak — Live Q&A for events',
    description: 'Real-time audience Q&A for live events. No account required.',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GuestSpeak — Live Q&A for events',
    description: 'Real-time audience Q&A for live events. No account required.',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#1A0A2E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
