'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

// ─── Name generator ───────────────────────────────────────────────────────────

const ADJECTIVES = [
  'Amber', 'Arctic', 'Blazing', 'Bold', 'Bright', 'Calm', 'Clever', 'Cobalt',
  'Coral', 'Cosmic', 'Crimson', 'Crystal', 'Daring', 'Dawn', 'Dusty', 'Eager',
  'Echo', 'Electric', 'Ember', 'Epic', 'Frosty', 'Gilded', 'Golden', 'Grand',
  'Indigo', 'Iron', 'Jade', 'Keen', 'Lunar', 'Magma', 'Marble', 'Mellow',
  'Midnight', 'Noble', 'Neon', 'Obsidian', 'Onyx', 'Opal', 'Pixel', 'Prism',
  'Quick', 'Radiant', 'Rapid', 'Rustic', 'Sage', 'Scarlet', 'Silver', 'Solar',
  'Sonic', 'Stellar', 'Storm', 'Swift', 'Tangy', 'Teal', 'Thunder', 'Topaz',
  'Turbo', 'Twilight', 'Velvet', 'Vivid', 'Wandering', 'Wild', 'Windy', 'Witty',
  'Zinc', 'Zesty',
];

const NOUNS = [
  'Albatross', 'Badger', 'Bear', 'Bison', 'Bobcat', 'Buzzard', 'Capybara',
  'Caribou', 'Cheetah', 'Condor', 'Corgi', 'Crane', 'Crow', 'Dingo', 'Dolphin',
  'Eagle', 'Falcon', 'Ferret', 'Finch', 'Fox', 'Gecko', 'Gorilla', 'Grackle',
  'Heron', 'Husky', 'Ibis', 'Jackal', 'Jaguar', 'Kestrel', 'Koala', 'Lemur',
  'Lynx', 'Magpie', 'Marmot', 'Meerkat', 'Mongoose', 'Moose', 'Narwhal', 'Newt',
  'Osprey', 'Otter', 'Panda', 'Panther', 'Parrot', 'Pelican', 'Penguin', 'Puffin',
  'Quail', 'Raven', 'Rhino', 'Salamander', 'Scorpion', 'Serval', 'Sloth', 'Sparrow',
  'Tapir', 'Toucan', 'Viper', 'Vulture', 'Walrus', 'Weasel', 'Wolverine', 'Wombat',
  'Yak', 'Zebra',
];

function generateName(): string {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${adj}${noun}${num}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
type Availability = 'auto' | 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

// ─── Component ────────────────────────────────────────────────────────────────

export default function GuestUsernameModal({
  sessionTitle,
  onJoin,
}: {
  sessionTitle: string;
  onJoin: (username: string) => Promise<void>;
}) {
  const [username, setUsername]         = useState<string>(() => generateName());
  const [isAuto, setIsAuto]             = useState(true);
  const [availability, setAvailability] = useState<Availability>('auto');
  const [joining, setJoining]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  // When user edits the input manually, switch to manual mode and run availability check
  useEffect(() => {
    if (isAuto) return; // skip for auto-generated names

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
  }, [username, isAuto]);

  const shuffle = useCallback(() => {
    const name = generateName();
    setUsername(name);
    setIsAuto(true);
    setAvailability('auto');
    setError(null);
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setUsername(val);
    setIsAuto(false);
    setAvailability('idle');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setJoining(true);
    setError(null);
    try {
      await onJoin(username.trim());
    } catch (err: any) {
      const isNetworkError = err instanceof TypeError && err.message === 'Failed to fetch';
      setError(isNetworkError
        ? 'No internet connection. Check your connection and try again.'
        : (err.message ?? 'Failed to join. Please try again.'));
      setJoining(false);
    }
  }

  const canSubmit = !joining && (
    isAuto || availability === 'available'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0">
      <div className="w-full max-w-sm bg-brand-card border border-brand-border rounded-2xl p-6 shadow-2xl">

        {/* Header */}
        <div className="mb-5">
          <p className="text-xs text-brand-orange font-bold uppercase tracking-widest mb-1">Joining</p>
          <h2 className="text-white font-bold text-lg leading-snug line-clamp-2">{sessionTitle}</h2>
          <p className="text-purple-200/50 text-sm mt-1">You'll post as this name. No account needed.</p>
        </div>

        {/* Auto-name pill */}
        {isAuto && (
          <div className="flex items-center justify-between mb-3 bg-brand-bg border border-brand-border rounded-xl px-4 py-3">
            <span className="text-white font-mono font-semibold text-sm tracking-wide truncate min-w-0 mr-3">{username}</span>
            <button
              type="button"
              onClick={shuffle}
              title="Try another name"
              className="flex items-center gap-1.5 text-xs text-purple-200/50 hover:text-purple-200 transition-colors shrink-0 py-1.5 px-2 -mr-2 min-h-[44px]"
            >
              {/* Shuffle icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
              </svg>
              Try another
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">

          {/* Custom name toggle / input */}
          {isAuto ? (
            <button
              type="button"
              onClick={() => {
                setUsername('');
                setIsAuto(false);
                setAvailability('idle');
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className="text-xs text-purple-200/40 hover:text-purple-200/70 transition-colors w-full text-center py-3 min-h-[44px] flex items-center justify-center"
            >
              Or type your own name →
            </button>
          ) : (
            <div className="space-y-1">
              <div className="relative">
                <input
                  ref={inputRef}
                  autoFocus
                  value={username}
                  onChange={handleInputChange}
                  placeholder="your_name"
                  maxLength={30}
                  className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-base
                             placeholder-white/25 focus:outline-none focus:border-brand-purple transition-colors pr-10"
                />
                {/* Status icon */}
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

              {/* Hint */}
              <p className="text-xs min-h-[1rem] pl-1">
                {availability === 'invalid' && <span className="text-red-400">2–30 chars, letters/numbers/underscores only</span>}
                {availability === 'taken'   && <span className="text-red-400">That name is taken by a registered user</span>}
                {availability === 'available' && <span className="text-emerald-400">Looks good!</span>}
                {availability === 'idle'    && <span className="text-purple-200/30">Letters, numbers, and underscores only</span>}
              </p>

              <button
                type="button"
                onClick={shuffle}
                className="text-xs text-purple-200/40 hover:text-purple-200/70 transition-colors w-full text-center py-3 min-h-[44px] flex items-center justify-center"
              >
                ← Back to a suggested name
              </button>
            </div>
          )}

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
