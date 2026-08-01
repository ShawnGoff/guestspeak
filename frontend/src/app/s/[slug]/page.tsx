import type { Metadata } from 'next';
import SessionPageClient from './SessionPageClient';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Props {
  params: { slug: string };
}

// ─── Server-side metadata ─────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${params.slug}`, {
      next: { revalidate: 60 }, // cache for 60 s; fresh enough for live sessions
    });
    if (!res.ok) return fallbackMetadata();

    const session = await res.json();
    const title = `${session.title} — GuestSpeak`;
    const description = session.description?.trim()
      ? session.description
      : `Live Q&A hosted by ${session.host_username}. Ask questions and Echo the ones you want answered most. No account needed.`;

    const imageUrl = `/s/${params.slug}/opengraph-image`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: [{ url: imageUrl, width: 1200, height: 630, alt: session.title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [imageUrl],
      },
    };
  } catch {
    return fallbackMetadata();
  }
}

function fallbackMetadata(): Metadata {
  return {
    title: 'GuestSpeak — Live Q&A',
    description: 'Real-time audience Q&A for live events. No account needed.',
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionPage({ params }: Props) {
  return <SessionPageClient params={params} />;
}
