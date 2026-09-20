'use client';

/**
 * The furniture around the question feed: the header, the host's control bar,
 * the credit meter and the sort tabs.
 *
 * The credit meter says the word "Credits" at every width. It used to be
 * hidden below sm, which left a phone showing six unexplained dots — and the
 * scarcity those dots represent is most of why the format works.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import QRCode from 'react-qr-code';
import { plural } from '@/lib/plural';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import type { SortOption } from '@/components/session/types';
import { StatusBadge } from '@/components/session/screens';
import ChannelAvatar from '@/components/ChannelAvatar';
import FollowChannel from '@/components/FollowChannel';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';

// ─── Session header ───────────────────────────────────────────────────────────

export const SORT_TABS: { value: SortOption; label: string }[] = [
  { value: 'echoes',   label: '🔥 Top' },
  { value: 'recent',   label: '🕐 Recent' },
  { value: 'answered', label: '✓ Answered' },
  { value: 'starred',  label: '★ Starred' },
];

export function SessionHeader({ session, isLiveSoon, credits, isMod, hostView, participantCount, nextCreditSecs, creditCap, regenCap, isRegistered, regenExhausted, regenPaused, slug, onToggleHostView, onReport }: {
  session: Session;
  isLiveSoon: boolean;
  credits: number;
  isMod: boolean;
  hostView: boolean;
  participantCount: number | null;
  nextCreditSecs?: number;
  creditCap?: number;
  regenCap?: number;
  isRegistered?: boolean;
  regenExhausted?: boolean;
  regenPaused?: boolean;
  slug?: string;
  onToggleHostView: () => void;
  onReport?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-brand-bg/90 backdrop-blur border-b border-brand-border/50">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusBadge status={session.status} isLiveSoon={isLiveSoon} />
            {session.status === 'live' && participantCount !== null && (
              <span className="text-xs text-purple-200/85 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                {participantCount}
              </span>
            )}
            {session.org_name && (
              <Link href={`/org/${session.org_slug}`} className="text-xs text-brand-orange/70 hover:text-brand-orange truncate flex items-center gap-1">
                {session.org_name}
                {session.org_is_verified && (
                  <span title="Verified" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-brand-orange text-white flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </Link>
            )}
          </div>
          <h1 className="text-white font-bold text-base leading-tight truncate">{session.title}</h1>
          {session.host_username && (
            <p className="text-purple-200/90 text-xs mt-0.5">hosted by {session.host_username}</p>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {!isMod && <CreditDisplay credits={credits} max={session.credits_per_user} nextCreditSecs={nextCreditSecs} creditCap={creditCap} regenCap={regenCap} isRegistered={isRegistered} regenExhausted={regenExhausted} regenPaused={regenPaused} slug={slug} />}
          {isMod && (
            <button
              onClick={onToggleHostView}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                hostView
                  ? 'bg-brand-orange/20 border-brand-orange text-brand-orange'
                  : 'border-brand-border text-purple-200/90 hover:border-brand-orange hover:text-brand-orange'
              }`}
            >
              {hostView ? '★ Host view' : 'Host view'}
            </button>
          )}
          {/* Touch targets, not just text. These were 16px-tall links and a
              14px icon — under half the 44px a thumb hits reliably — and the
              report control carried only a title attribute, which a touch
              device never shows and a screen reader treats as optional. The
              negative margin keeps the visual spacing while the hit area
              grows. */}
          <div className="flex items-center gap-1 -mr-2 lg:hidden">
            <Link
              href="/discover"
              className="text-xs text-purple-200/85 hover:text-white transition-colors px-2 min-h-[44px] flex items-center"
            >
              ← Discover
            </Link>
            {isMod
              ? null
              : (
                <Link
                  href="/dashboard"
                  className="text-xs text-purple-200/75 hover:text-white transition-colors px-2 min-h-[44px] flex items-center"
                >
                  Dashboard
                </Link>
              )
            }
            {!isMod && onReport && (
              <button
                onClick={onReport}
                aria-label="Report this session"
                title="Report this session"
                className="text-purple-200/40 hover:text-red-400/70 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <FlagIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Host control bar ─────────────────────────────────────────────────────────

// ─── Host control bar ─────────────────────────────────────────────────────────

export function HostControlBar({ session, closing, reopening, deleting, onGoLive, onClose, onReopen, onDelete, onExport, onManageMods, callerRole }: {
  session: Session;
  closing: boolean;
  reopening: boolean;
  deleting: boolean;
  onGoLive: () => void;
  onClose: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onExport: () => void;
  onManageMods: () => void;
  callerRole: CallerRole;
}) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [shared, setShared] = useState(false);

  const joinCode = session.join_code;
  const joinUrl  = typeof window !== 'undefined'
    ? `${window.location.origin}/s/${session.slug}`
    : '';
  const isOwner = ['host', 'org_owner', 'org_admin'].includes(callerRole);

  function copyCode() {
    navigator.clipboard.writeText(joinCode ?? '');
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  async function share() {
    if (navigator.share) {
      await navigator.share({ title: session.title, text: `Join "${session.title}" on GuestSpeak`, url: joinUrl }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(joinUrl);
      setShared(true); setTimeout(() => setShared(false), 2000);
    }
  }

  return (
    <div className="bg-brand-card border-b border-brand-purple/25">
      <div className="max-w-7xl mx-auto px-4 py-3">

        {/* Primary row — status action + join code */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Primary session action — owner-only */}
          {isOwner && session.status === 'upcoming' && (
            <button
              onClick={() => { if (confirm('Go live now?')) onGoLive(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Go live
            </button>
          )}
          {isOwner && session.status === 'live' && (
            <button
              onClick={() => { if (confirm('Close this session? Submissions will stop.')) onClose(); }}
              disabled={closing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-sm hover:bg-red-500/20 transition-colors disabled:opacity-40"
            >
              {closing ? 'Closing…' : 'Close session'}
            </button>
          )}
          {session.status === 'closed' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-purple-200/85 uppercase tracking-wider">Session ended</span>
              {isOwner && (
                <>
                  <button onClick={onExport} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/90 hover:text-white transition-colors">
                    <DownloadIcon /> Export CSV
                  </button>
                  <button onClick={onReopen} disabled={reopening} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40">
                    {reopening ? 'Reopening…' : 'Reopen'}
                  </button>
                  <button onClick={onDelete} disabled={deleting} className="text-xs px-3 py-1.5 rounded-lg border border-red-700/40 text-red-400/70 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40">
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Join code — tappable to copy */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={copyCode}
              title="Tap to copy join code"
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border font-mono transition-colors sm:ml-auto min-h-[44px] ${
                copied ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-white hover:border-brand-purple'
              }`}
            >
              <span className="text-purple-200/85 text-xs font-sans">Code</span>
              <span className="text-sm font-bold tracking-widest">{joinCode}</span>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}

          {/* QR toggle */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={() => setShowQR(v => !v)}
              title="Show QR code"
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showQR ? 'border-brand-purple text-brand-purple' : 'border-brand-border text-purple-200/85 hover:text-white hover:border-brand-border'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <path d="M14 14h.01M17 14h.01M14 17h.01M17 17h.01M20 14h.01M20 17h.01M20 20h.01" />
              </svg>
            </button>
          )}

          {/* Share */}
          {session.status !== 'closed' && (
            <button onClick={share} title="Share session link"
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${shared ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-purple-200/85 hover:text-white hover:border-brand-border'}`}>
              {shared ? <CheckIcon /> : <ShareIcon />}
            </button>
          )}
        </div>

        {/* Secondary row — owner-only admin actions */}
        {isOwner && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-brand-border/30 max-w-7xl">
            <Link href={`/s/${session.slug}/edit`} className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors">Edit session</Link>
            <span className="text-brand-border">·</span>
            <button onClick={onManageMods} className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors">Manage moderators</button>
          </div>
        )}
      </div>

      {/* QR panel */}
      {showQR && joinUrl && (
        <div className="border-t border-brand-border/30 py-4 flex flex-col items-center gap-2">
          <div className="bg-white rounded-2xl p-4 inline-block">
            <QRCode value={joinUrl} size={160} />
          </div>
          <p className="text-xs text-purple-200/85">Audience scans to join — no app needed</p>
        </div>
      )}
    </div>
  );
}

// ─── Credit display ───────────────────────────────────────────────────────────

// ─── Credit display ───────────────────────────────────────────────────────────

export function CreditDisplay({ credits, max, nextCreditSecs, creditCap, regenCap, isRegistered, regenExhausted, regenPaused, slug }: {
  credits: number;
  max: number;
  nextCreditSecs?: number;
  creditCap?: number;
  regenCap?: number;
  isRegistered?: boolean;
  regenExhausted?: boolean;
  regenPaused?: boolean;
  slug?: string;
}) {
  const cap = creditCap ?? max;
  const regenTo = regenCap ?? cap;

  // The countdown appears only when a credit is genuinely on its way.
  //
  // It used to appear whenever any credit had been spent, measured against the
  // host's per-user setting rather than the ceiling regeneration actually
  // refills to. For a guest those differ — a host may grant 6, but regeneration
  // stops at 2 — so a guest sitting on 5 credits was shown "+1 in 10:00" for a
  // credit that was never coming, and the timer appeared to restart on every
  // reload because the server keeps reporting a full interval when nothing is
  // pending.
  // Before the show starts there is nothing on its way: the opening allocation
  // is all there is until the host goes live, so a countdown here would be
  // promising a credit that cannot arrive.
  const regenPending = credits < regenTo && !regenExhausted && !regenPaused;
  const showCountdown = nextCreditSecs !== undefined && regenPending;
  const mins = Math.floor((nextCreditSecs ?? 0) / 60);
  const secs = String((nextCreditSecs ?? 0) % 60).padStart(2, '0');

  // Guests see the free tier stated plainly once they are at or below it. The
  // empty dots above regenTo are deliberate — they show what an account unlocks
  // — but on their own they read as credits that are simply missing.
  const showGuestTier = !isRegistered && credits <= regenTo && !showCountdown;

  return (
    <div className="flex items-center gap-1.5">
      {/* Shown on a phone too. Hidden below sm, the meter was six dots and a
          bare number with nothing saying what they counted. */}
      <span className="text-xs text-purple-200/85">Credits</span>
      <div className="flex gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${i < credits ? 'bg-brand-orange' : 'bg-brand-border/60'}`} />
        ))}
      </div>
      <span className={`text-xs font-bold ${credits > 0 ? 'text-brand-amber' : 'text-purple-200/85'}`}>{credits}</span>
      {showCountdown && (
        <span className="text-xs text-purple-200/90 tabular-nums">+1 in {mins}:{secs}</span>
      )}
      {showGuestTier && (
        <span className="text-xs text-purple-200/85 whitespace-nowrap">
          <Link
            href={`/register${slug ? `?next=${encodeURIComponent(`/s/${slug}`)}` : ''}`}
            className="text-brand-orange font-semibold hover:text-brand-amber transition-colors"
          >
            {/* The offer is that replenishment never stops, not a quantity.
                Guests already start with the host's full allowance, so naming a
                number ("2/2 free", "unlock all 6") either duplicated the count
                beside it or described something they already had. What actually
                runs out is refills: a guest gets two and then none, ever.
                Wording matches the upgrade modal's "unlimited replenishment". */}
            Sign up for unlimited credits
          </Link>
        </span>
      )}
    </div>
  );
}

export function SortTabs({ sort, onChange, showHidden = false, hiddenCount = 0 }: {
  sort: SortOption;
  onChange: (s: SortOption) => void;
  /** Session staff only — the audience must not learn that hidden content exists. */
  showHidden?: boolean;
  hiddenCount?: number;
}) {
  const tabs = showHidden
    ? [...SORT_TABS, { value: 'hidden' as SortOption, label: `🚫 Hidden${hiddenCount ? ` (${hiddenCount})` : ''}` }]
    : SORT_TABS;

  return (
    <div className="flex border-b border-brand-border/60 overflow-x-auto gap-0">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all ${
            sort === tab.value
              ? 'border-brand-orange text-white'
              : 'border-transparent text-purple-200/85 hover:text-purple-200/90'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
