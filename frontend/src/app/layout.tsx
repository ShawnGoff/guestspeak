import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GuestSpeak — Live Q&A for events',
  description: 'Real-time audience Q&A. Submit questions, add Echoes to the ones you want answered most.',
  openGraph: {
    title: 'GuestSpeak',
    description: 'Live Q&A for events. No account required.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
