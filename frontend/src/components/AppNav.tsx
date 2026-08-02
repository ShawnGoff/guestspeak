'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { getUser, clearAuth } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';
import NotificationBell from './NotificationBell';

const MAX_WIDTH: Record<string, string> = {
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
};

/**
 * Shared top nav for all app pages (not auth pages, not the session live view).
 *
 * Left side:  GuestSpeak logo → Discover link (always)
 * Right side: pass `right` prop for page-specific controls
 */
function UserMenu({ user }: { user: AuthUser }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router  = useRouter();

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function signOut() {
    clearAuth();
    setOpen(false);
    router.push('/');
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title={`@${user.username}`}
        className={`transition-colors p-1 ${open ? 'text-brand-amber' : 'text-purple-200/40 hover:text-white'}`}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 bg-brand-card border border-brand-border rounded-xl shadow-2xl overflow-hidden z-50 py-1">
          <p className="px-4 py-2 text-xs text-purple-200/40 border-b border-brand-border/50 truncate">
            @{user.username}
          </p>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-purple-200/70 hover:text-white hover:bg-brand-border/20 transition-colors"
          >
            Settings
          </Link>
          <button
            onClick={signOut}
            className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-red-400/70 hover:text-red-400 hover:bg-brand-border/20 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppNav({
  right,
  maxWidth = '2xl',
}: {
  right?: React.ReactNode;
  maxWidth?: '2xl' | '3xl' | '4xl' | '5xl';
}) {
  const pathname = usePathname();
  const mw = MAX_WIDTH[maxWidth] ?? 'max-w-2xl';
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { setUser(getUser()); }, []);

  return (
    <nav className="sticky top-0 z-40 bg-brand-bg/90 backdrop-blur border-b border-brand-border/50">
      <div className={`${mw} mx-auto px-4 h-14 flex items-center justify-between gap-3`}>
        {/* Left — logo + persistent nav links */}
        <div className="flex items-center gap-5 flex-shrink-0">
          <Link href="/" className="text-xl font-bold tracking-tight text-white">
            Guest<span className="text-brand-orange">Speak</span>
          </Link>
          <Link
            href="/discover"
            className={`text-sm font-medium transition-colors ${
              pathname === '/discover'
                ? 'text-brand-amber'
                : 'text-purple-200/50 hover:text-white'
            }`}
          >
            Discover
          </Link>
        </div>

        {/* Right — page-specific controls + notifications + user settings */}
        <div className="flex items-center gap-3">
          {right}
          {user && !user.is_guest && (
            <>
              <NotificationBell />
              <UserMenu user={user} />
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
