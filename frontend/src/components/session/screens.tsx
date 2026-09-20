'use client';

/**
 * Whole-screen states: loading, error, the welcome mat, and the two prompts
 * that stand between a guest and an account.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import ChannelAvatar from '@/components/ChannelAvatar';
import Link from 'next/link';
import { plural } from '@/lib/plural';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';

// ─── Utility screens ──────────────────────────────────────────────────────────

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-purple-200/90 text-sm">Joining session…</p>
      </div>
    </div>
  );
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="text-center card p-8 max-w-sm">
        <p className="text-4xl mb-3">🔍</p>
        <h2 className="text-white font-bold text-lg mb-2">Session not found</h2>
        <p className="text-purple-200/90 text-sm mb-6">{message}</p>
        <Link href="/" className="btn-primary">Back to GuestSpeak</Link>
      </div>
    </div>
  );
}

// ─── Guest sign-up prompt ────────────────────────────────────────────────────

// ─── Guest sign-up prompt ────────────────────────────────────────────────────

export function GuestSignupPrompt({ slug, onDismiss }: { slug: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="card p-7 w-full max-w-sm text-center mb-4 sm:mb-0">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-brand-orange" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
          </svg>
        </div>

        <h2 className="text-white font-bold text-xl mb-2">Keep contributing!</h2>
        <p className="text-purple-200/80 text-sm leading-relaxed mb-6">
          You&apos;ve used your credits for now. Sign up free and there&apos;s{' '}
          <span className="text-brand-amber font-semibold">no cap on additional earned credits</span>{' '}
          — keep earning as long as the event goes on.
        </p>

        <Link
          href={`/register?next=${encodeURIComponent('/s/' + slug)}`}
          className="btn-primary w-full py-3 text-sm block mb-3"
        >
          Sign up free — it&apos;s quick
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent('/s/' + slug)}`}
          className="block text-sm text-purple-200/90 hover:text-white transition-colors mb-4"
        >
          Already have an account? Sign in
        </Link>
        <button
          onClick={onDismiss}
          className="text-xs text-purple-200/75 hover:text-purple-200/90 transition-colors"
        >
          Maybe later — continue watching
        </button>
      </div>
    </div>
  );
}

// ─── Regen upgrade modal — inline signup when guest regen is exhausted ────────

// ─── Regen upgrade modal — inline signup when guest regen is exhausted ────────

export function RegenUpgradeModal({ slug, onDismiss }: { slug: string; onDismiss: () => void }) {
  const [email, setEmail]       = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !username || !password) return;
    setLoading(true); setError(null);
    try {
      // The guest's own JWT goes up in the Authorization header (api attaches it),
      // and the server reads the guest token from there. It is deliberately NOT
      // sent in the body: the server used to trust a body parameter, which let
      // anyone who had seen a guest's token — it travels in the SSE query string
      // and a JWT payload is plain base64 — register and claim that guest's
      // questions and participant row.
      const result = await api.post<{ token: string; user: any }>('/auth/register', {
        email, username, password,
      });
      saveAuth(result.token, result.user);
      setSuccess(true);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err: any) {
      setError(err.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="card p-7 w-full max-w-sm text-center mb-4 sm:mb-0">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-xl mb-2">You&apos;re in!</h2>
          <p className="text-purple-200/90 text-sm">Reloading your session with unlimited replenishment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="card p-7 w-full max-w-sm mb-4 sm:mb-0">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-brand-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </div>

        <h2 className="text-white font-bold text-xl text-center mb-1">Keep up your contribution!</h2>
        <p className="text-purple-200/90 text-sm text-center mb-6">
          Create a free account to receive{' '}
          <span className="text-brand-amber font-semibold">unlimited credit replenishment</span>{' '}
          for the rest of this event.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors"
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            autoComplete="username"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors"
          />
          <input
            type="password"
            placeholder="Password (8+ characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors"
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading || !email || !username || password.length < 8}
            className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account…' : 'Create account — it\'s free'}
          </button>
        </form>

        <p className="text-xs text-purple-200/75 text-center mt-4">
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent('/s/' + slug)}`}
            className="text-brand-orange hover:text-brand-amber transition-colors"
          >
            Sign in instead
          </Link>
        </p>

        <button
          onClick={onDismiss}
          className="block w-full text-center text-xs text-purple-200/70 hover:text-purple-200/85 transition-colors mt-3"
        >
          Maybe later — I still have credits
        </button>
      </div>
    </div>
  );
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

// ─── Welcome screen ───────────────────────────────────────────────────────────

export function WelcomeScreen({ session, onEnter }: {
  session: Session & { org_avatar_url?: string };
  onEnter: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-brand-bg px-4 py-8 overflow-y-auto">
      <div className="card p-8 w-full max-w-sm text-center my-auto">
        {/* Channel avatar */}
        {session.org_name ? (
          <ChannelAvatar
            name={session.org_name}
            src={(session as any).org_avatar_url}
            className="w-16 h-16 rounded-full mx-auto mb-4"
            textClassName="text-2xl"
          />
        ) : (
          <div className="w-16 h-16 rounded-full mx-auto mb-4 bg-brand-orange/20 border border-brand-orange/30 flex items-center justify-center">
            <span className="text-brand-orange font-bold text-2xl">Q</span>
          </div>
        )}

        {session.org_name && (
          <p className="text-brand-orange/70 text-xs font-semibold uppercase tracking-widest mb-2">{session.org_name}</p>
        )}

        <h1 className="text-white font-bold text-xl leading-snug mb-3">{session.title}</h1>

        {session.description && (
          <p className="text-purple-200/90 text-sm leading-relaxed mb-6">{session.description}</p>
        )}

        <div className="flex items-center justify-center gap-2 mb-8">
          <StatusBadge status={session.status} isLiveSoon={false} />
          {session.host_username && (
            <span className="text-xs text-purple-200/85">· hosted by {session.host_username}</span>
          )}
        </div>

        <button onClick={onEnter} className="btn-primary w-full py-3 text-sm font-bold">
          Enter Q&amp;A
        </button>

        <p className="text-xs text-purple-200/70 mt-5">Powered by GuestSpeak</p>
      </div>
    </div>
  );
}

export function StatusBadge({ status, isLiveSoon }: { status: string; isLiveSoon: boolean }) {
  if (status === 'live') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Live
    </span>
  );
  if (isLiveSoon) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-pulse" />Live Soon
    </span>
  );
  if (status === 'closed') return (
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/90 text-xs font-semibold">Ended</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-purple/20 text-brand-amber text-xs font-semibold">Upcoming</span>
  );
}

// ─── Sort tabs ────────────────────────────────────────────────────────────────
