import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt    = 'GuestSpeak session';
export const size   = { width: 1200, height: 630 };
export const contentType = 'image/png';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Props {
  params: { slug: string };
}

export default async function OgImage({ params }: Props) {
  // Fetch session data — fall back gracefully if unavailable
  let title       = 'Live Q&A Session';
  let hostName    = '';
  let description = '';
  let status: string = 'live';

  try {
    const res = await fetch(`${API_BASE}/api/sessions/${params.slug}`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const s = await res.json();
      title       = s.title       ?? title;
      hostName    = s.host_username ?? '';
      description = s.description  ?? '';
      status      = s.status       ?? 'live';
    }
  } catch { /* fall through to defaults */ }

  const statusLabel =
    status === 'live'     ? 'LIVE NOW'  :
    status === 'upcoming' ? 'UPCOMING'  : 'ARCHIVED';

  const statusColor =
    status === 'live'     ? '#ef4444' :
    status === 'upcoming' ? '#F5921E' : '#6b7280';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#1A0A2E',
          padding: '64px',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-120px',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(245,146,30,0.12) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-80px',
            left: '-80px',
            width: '360px',
            height: '360px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(109,40,217,0.15) 0%, transparent 70%)',
          }}
        />

        {/* Top row — branding + status */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '48px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>Guest</span>
            <span style={{ fontSize: '28px', fontWeight: 800, color: '#F5921E' }}>Speak</span>
          </div>

          {/* Status pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: `${statusColor}20`,
              border: `1px solid ${statusColor}60`,
              borderRadius: '100px',
              padding: '8px 18px',
            }}
          >
            {status === 'live' && (
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor }} />
            )}
            <span style={{ fontSize: '14px', fontWeight: 700, color: statusColor, letterSpacing: '0.08em' }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Session title */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div
            style={{
              fontSize: title.length > 60 ? '44px' : title.length > 40 ? '52px' : '60px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.15,
              maxWidth: '900px',
              marginBottom: '24px',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </div>

          {description && (
            <div
              style={{
                fontSize: '22px',
                color: 'rgba(196,181,253,0.6)',
                maxWidth: '800px',
                lineHeight: 1.5,
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {description}
            </div>
          )}
        </div>

        {/* Bottom row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '32px',
            borderTop: '1px solid rgba(59,31,106,0.8)',
          }}
        >
          {hostName ? (
            <span style={{ fontSize: '20px', color: 'rgba(196,181,253,0.5)' }}>
              Hosted by <span style={{ color: 'rgba(196,181,253,0.8)', fontWeight: 600 }}>{hostName}</span>
            </span>
          ) : (
            <span />
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(245,146,30,0.12)',
              border: '1px solid rgba(245,146,30,0.3)',
              borderRadius: '12px',
              padding: '10px 20px',
            }}
          >
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#F5921E' }}>
              Join free — no account needed
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
