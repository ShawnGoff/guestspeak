'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

/**
 * Follow / unfollow a channel.
 *
 * Signed-out and guest callers are sent to sign up rather than being allowed to
 * press a button that cannot work. The API refuses them — following is
 * registered-only — and the previous version swallowed that rejection in an
 * empty catch, so the button flickered and returned to "Follow" with nothing
 * said. Looking broken is worse than saying no.
 *
 * `?next=` carries them back to whatever page they were on, so signing up in
 * the middle of a session does not cost them their place.
 */
export default function FollowChannel({
  orgId,
  initialFollowing = false,
  size = 'md',
}: {
  orgId: string;
  initialFollowing?: boolean;
  /** `sm` for inline use beside a channel name; `md` for a page header. */
  size?: 'sm' | 'md';
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setUser(getUser()); }, []);
  // The server is the authority — adopt its answer when the page data arrives.
  useEffect(() => { setFollowing(initialFollowing); }, [initialFollowing]);

  const canFollow = !!user && !user.is_guest;

  async function toggle() {
    if (!canFollow) {
      const next = encodeURIComponent(
        typeof window !== 'undefined' ? window.location.pathname : '/',
      );
      router.push(`/register?next=${next}`);
      return;
    }

    // Optimistic, because the round-trip is longer than the button feels like
    // it should take — but reverted on failure rather than left lying.
    const wanted = !following;
    setFollowing(wanted);
    setBusy(true);
    setFailed(false);
    try {
      if (wanted) await api.post(`/orgs/${orgId}/follow`, {});
      else        await api.delete(`/orgs/${orgId}/follow`);
    } catch {
      setFollowing(!wanted);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={canFollow
        ? (following ? 'Stop following this channel' : 'Get notified when this channel goes live')
        : 'Sign up to follow this channel'}
      className={`font-semibold rounded-xl border transition-colors disabled:opacity-40 ${pad} ${
        failed
          ? 'border-red-400/70 text-red-300'
          : following
            ? 'border-brand-purple bg-brand-purple/20 text-white'
            : 'border-brand-orange text-brand-orange hover:bg-brand-orange/10'
      }`}
    >
      {failed ? 'Try again' : following ? 'Following' : 'Follow'}
    </button>
  );
}
