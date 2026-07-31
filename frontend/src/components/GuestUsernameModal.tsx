'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function GuestUsernameModal({
  sessionTitle,
  onJoin,
}: {
  sessionTitle: string;
  onJoin: (username: string) => Promise<void>;
}) {
  const [username, setUsername]         = useState('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [joining, setJoining]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(checkTimer.current);
    const trimmed = username.trim();

    if (!trimmed) { setAvailability('idle'); return; }

    if (trimmed.length < 2 || trimmed.length > 30 || !USERNAME_RE.test(trimmed)) {
      setAvailability('invalid');
      return;
    }

    setAvailability('checking');
    checkTimer.current = setTimeout(async () => {
      try {
        const { available } = await api.get<{ available: boolean }>(
          `/auth/check-username?username=${encodeURIComponent(trimmed)}`,
        );
        setAvailability(available ? 'available' : 'taken');
      } catch {
        setAvailability('idle');
      }
    }, 350);

    return () => clearTimeout(checkTimer.current);
  }, [username]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (availability !== 'available') return;
    setJoining(true);
    setError(null);
    try {
      await onJoin(username.trim());
    } catch (err: any) {
      setError(err.message ?? 'Failed to join');
      setJoining(false);
    }
  }

  const canSubmit = availability === 'available' && !joining;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0">
      <div className="w-full max-w-sm bg-brand-card border border-brand-border rounded-2xl p-6 shadow-2xl">

        {/* Header */}
        <div className="mb-5">
          <p className="text-xs text-brand-orange font-bold uppercase tracking-widest mb-1">Joining</p>
          <h2 className="text-white font-bold text-lg leading-snug line-clamp-2">{sessionTitle}</h2>
          <p className="text-purple-200/50 text-sm mt-1">Pick a display name to participate.</p>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <input
              autoFocus
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your_name"
              maxLength={30}
              className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white
                         placeholder-brand-border/50 focus:outline-none focus:border-brand-purple transition-colors pr-10"
            />
            {/* Status indicator */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {availability === 'checking' && (
                <svg className="w-4 h-4 text-purple-200/30 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {availability === 'available' && (
                <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
              {(availability === 'taken' || availability === 'invalid') && (
                <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              )}
            </div>
          </div>

          {/* Hint text */}
          <p className="text-xs -mt-2 min-h-[1rem]">
            {availability === 'invalid' && (
              <span className="text-red-400">2–30 characters, letters/numbers/underscores only</span>
            )}
            {availability === 'taken' && (
              <span className="text-red-400">That name is taken by a registered user</span>
            )}
            {availability === 'available' && (
              <span className="text-emerald-400">Looks good!</span>
            )}
            {availability === 'idle' && (
              <span className="text-purple-200/30">Letters, numbers, and underscores only</span>
            )}
          </p>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {joining ? 'Joining…' : 'Join session'}
          </button>
        </form>

        {/* Login link */}
        <p className="text-center text-xs text-purple-200/30 mt-4">
          Have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}
            className="text-brand-orange hover:text-brand-amber transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
