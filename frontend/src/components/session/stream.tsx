'use client';

/**
 * Turning a stream URL into an embed.
 *
 * parseStream is pure — a string in, a provider and id out — and once it is
 * out of a 3,000-line client component it can be unit tested, which is the
 * real reason this slice went first.
 */

import { useState } from 'react';

// ─── Stream embed ─────────────────────────────────────────────────────────────

export type StreamInfo =
  | { type: 'youtube'; embedUrl: string; watchUrl: string }
  | { type: 'twitch';  embedUrl: string; watchUrl: string }
  | { type: 'link';    watchUrl: string };

/** Hostname must be the real host or a subdomain of it — never just a substring. */
/** Hostname must be the real host or a subdomain of it — never just a substring. */
export function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function parseStream(url: string): StreamInfo | null {
  if (!url) return null;

  // Match on the parsed hostname, not a substring of the whole URL: a bare
  // /youtube\.com/ test also matches https://example.com/youtube.com/x, which
  // would render a player for a URL that isn't a YouTube link at all.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return { type: 'link', watchUrl: url };

  const host = parsed.hostname.replace(/^www\./, '');

  if (isHost(host, 'youtube.com') || isHost(host, 'youtu.be')) {
    const id = isHost(host, 'youtu.be')
      ? parsed.pathname.slice(1)
      : parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1] ?? '';

    if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return {
        type: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`,
        watchUrl: url,
      };
    }
  }

  if (isHost(host, 'twitch.tv')) {
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'guestspeak.app';

    const videoId = parsed.pathname.match(/^\/videos\/(\d+)$/)?.[1];
    if (videoId) {
      return {
        type: 'twitch',
        embedUrl: `https://player.twitch.tv/?video=${videoId}&parent=${parent}&autoplay=false`,
        watchUrl: url,
      };
    }

    const channel = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/)?.[1];
    if (channel && channel !== 'videos') {
      return {
        type: 'twitch',
        embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=false`,
        watchUrl: url,
      };
    }
  }

  // Anything else — link fallback
  return { type: 'link', watchUrl: url };
}

export function StreamEmbed({ url, sessionSlug }: { url: string; sessionSlug: string }) {
  // Every hook must run before any early return. If the host clears the stream
  // URL mid-session, parseStream starts returning null and a bailout above the
  // useState would change the hook count on an already-mounted component,
  // crashing the page for everyone watching.
  const storageKey = `gs_hide_stream_${sessionSlug}`;
  const [hidden, setHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });

  const info = parseStream(url);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    localStorage.setItem(storageKey, next ? '1' : '0');
  }

  if (!info) return null;

  if (info.type === 'link') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-brand-card border border-brand-border rounded-xl px-4 py-3">
        <svg className="w-5 h-5 text-brand-orange flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-sm text-purple-200/85 flex-1">This session is streaming live</span>
        <a
          href={info.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-brand-orange hover:text-brand-amber transition-colors flex-shrink-0"
        >
          Watch live →
        </a>
      </div>
    );
  }

  return (
    <div className="mb-4">
      {/* Header row — label + hide toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-xs font-semibold text-purple-200/90 uppercase tracking-wider">
            {info.type === 'youtube' ? 'YouTube Live' : 'Twitch Stream'}
          </span>
        </div>
        <button
          onClick={toggle}
          className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors flex items-center gap-1"
        >
          {hidden ? (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Show video
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              Hide video
            </>
          )}
        </button>
      </div>

      {/* Embed — 16:9 aspect ratio */}
      {!hidden && (
        <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={info.embedUrl}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            title="Live stream"
          />
        </div>
      )}

      {/* When hidden — compact pill so they can still find the stream */}
      {hidden && (
        <div className="flex items-center justify-between bg-brand-card border border-brand-border/50 rounded-xl px-4 py-2.5">
          <span className="text-sm text-purple-200/85">Stream hidden</span>
          <a
            href={info.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-brand-orange hover:text-brand-amber transition-colors"
          >
            Open in {info.type === 'youtube' ? 'YouTube' : 'Twitch'} →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

// ─── Report session modal ──────────────────────────────────────────────────────
