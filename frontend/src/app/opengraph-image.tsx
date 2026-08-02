import { ImageResponse } from 'next/og';

export const runtime     = 'edge';
export const alt         = 'GuestSpeak — Live Q&A for events';
export const size        = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1A0A2E',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glows */}
        <div style={{
          position: 'absolute', top: '-100px', right: '-100px',
          width: '500px', height: '500px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,146,30,0.15) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-80px', left: '-80px',
          width: '400px', height: '400px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(109,40,217,0.18) 0%, transparent 70%)',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '32px' }}>
          <span style={{ fontSize: '72px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.03em' }}>Guest</span>
          <span style={{ fontSize: '72px', fontWeight: 800, color: '#F5921E', letterSpacing: '-0.03em' }}>Speak</span>
        </div>

        {/* Tagline */}
        <p style={{
          fontSize: '28px',
          color: 'rgba(196,181,253,0.65)',
          fontWeight: 500,
          letterSpacing: '0.01em',
          marginBottom: '48px',
        }}>
          Live Q&amp;A for events that matter
        </p>

        {/* Feature pills */}
        <div style={{ display: 'flex', gap: '16px' }}>
          {['Ask questions', 'Add Echoes', 'No account needed'].map(label => (
            <div key={label} style={{
              background: 'rgba(245,146,30,0.1)',
              border: '1px solid rgba(245,146,30,0.25)',
              borderRadius: '100px',
              padding: '10px 22px',
              fontSize: '18px',
              fontWeight: 600,
              color: '#F5921E',
            }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
