'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';

/**
 * "Remind me" on an upcoming session card.
 *
 * Following a channel subscribes you to everything it puts on. This is the
 * other thing people want on Discover: one session, from a channel they may
 * never hear from again, and a nudge when it starts.
 *
 * Signed-out and guest callers go to sign up, the same as FollowChannel — the
 * API refuses them because a notification needs an account to land in.
 *
 * The card underneath is a link. This button therefore stops the click from
 * reaching it, and the caller must render it outside the anchor: a <button>
 * inside an <a> is invalid HTML, and browsers recover from it in their own
 * ways.
 */
export default function RemindMe({
  sessionId,
  user,
  initialReminded = false,
  onChange,
  className = '',
}: {
  sessionId: string;
  /** Passed down rather than read here — one getUser() per page, not per card. */
  user: AuthUser | null;
  initialReminded?: boolean;
  /** Lifted so the page's set survives this card unmounting on a refilter. */
  onChange?: (reminded: boolean) => void;
  className?: string;
}) {
  const router = useRouter();
  const [reminded, setReminded] = useState(initialReminded);
  const [busy, setBusy] = useState(false);

  // The page fetches the viewer's reminders after the cards have already
  // rendered, so this arrives as a prop change, not an initial value. Without
  // this the button seeds itself once from `false` and stays there — a
  // reminder you set yesterday reads as "Remind me" on every reload.
  useEffect(() => { setReminded(initialReminded); }, [initialReminded]);

  const canRemind = !!user && !user.is_guest;

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!canRemind) {
      const next = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '/discover',
      );
      router.push(`/register?next=${next}`);
      return;
    }
    if (busy) return;

    const wanted = !reminded;
    setReminded(wanted);
    onChange?.(wanted);
    setBusy(true);
    try {
      if (wanted) await api.post(`/sessions/${sessionId}/reminder`, {});
      else        await api.delete(`/sessions/${sessionId}/reminder`);
    } catch {
      // Revert rather than swallow. A bell that says "on" while the server
      // knows nothing about it is the one failure people would not forgive
      // here — they would simply miss the session.
      setReminded(!wanted);
      onChange?.(!wanted);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={reminded}
      // The label, not just the icon: a lone bell in a screen reader is a
      // shape, and "Remind me" vs "Reminder set" is the whole state.
      aria-label={reminded ? 'Reminder set — tap to cancel' : 'Remind me when this starts'}
      title={reminded ? 'Reminder set' : 'Remind me when this starts'}
      className={`inline-flex items-center justify-center gap-1.5 shrink-0 rounded-lg
        min-h-[36px] px-2.5 text-xs font-semibold transition-colors
        disabled:opacity-60
        ${reminded
          ? 'bg-brand-orange/20 text-brand-orange hover:bg-brand-orange/30'
          : 'bg-white/5 text-purple-200/80 hover:bg-white/10 hover:text-white'}
        ${className}`}
    >
      <BellIcon filled={reminded} className="w-3.5 h-3.5" />
      <span>{reminded ? 'Reminded' : 'Remind me'}</span>
    </button>
  );
}

function BellIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
