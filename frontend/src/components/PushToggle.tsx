'use client';

import { useEffect, useState } from 'react';
import { getPushState, enablePush, disablePush, type PushState } from '@/lib/push';
import { api } from '@/lib/api';

/**
 * Notification opt-in.
 *
 * Renders nothing when the browser cannot do push at all — an explanation
 * someone can do nothing about is just noise. The one case worth explaining is
 * iOS, where push works but only after the site is added to the Home Screen.
 */
export default function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyAvailable, setKeyAvailable] = useState(true);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'));
    // Hide the whole section if the server has no VAPID key configured, rather
    // than offering a toggle that cannot possibly work. Goes through the API
    // client so the auth token is attached — the notifications router requires
    // it, and a bare fetch here silently hid the toggle for everyone.
    api.get<{ key: string | null }>('/notifications/push/key')
      .then(d => setKeyAvailable(Boolean(d.key)))
      .catch(() => setKeyAvailable(false));
  }, []);

  if (state === null || state === 'unsupported' || !keyAvailable) return null;

  async function toggle() {
    setBusy(true); setError(null);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update notifications.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6 space-y-4">
      <div>
        <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-1">
          Notifications
        </h2>
        <p className="text-purple-200/75 text-sm">
          Get told when a channel you follow goes live, and when a host replies to
          your question.
        </p>
      </div>

      {state === 'ios-needs-install' ? (
        <div className="rounded-xl bg-brand-bg border border-brand-border p-4">
          <p className="text-sm text-white font-semibold mb-1">Add GuestSpeak to your Home Screen first</p>
          <p className="text-sm text-purple-200/75">
            On iPhone and iPad, notifications only work once a site is installed.
            Tap the Share button, then <span className="text-white">Add to Home Screen</span>,
            and open GuestSpeak from there.
          </p>
        </div>
      ) : state === 'denied' ? (
        <div className="rounded-xl bg-brand-bg border border-brand-border p-4">
          <p className="text-sm text-white font-semibold mb-1">Notifications are blocked</p>
          <p className="text-sm text-purple-200/75">
            You turned these down earlier. Browsers only let you undo that from
            their own site settings, not from here.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className={
              state === 'on'
                ? 'px-5 py-2.5 text-sm font-semibold rounded-lg border border-brand-border text-purple-200/85 hover:text-white transition-colors disabled:opacity-40'
                : 'btn-primary px-5 py-2.5 text-sm disabled:opacity-40'
            }
          >
            {busy
              ? 'Just a moment…'
              : state === 'on' ? 'Turn off notifications' : 'Turn on notifications'}
          </button>
          {state === 'on' && (
            <span className="text-sm text-emerald-400 font-medium">On for this device</span>
          )}
        </div>
      )}

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}
    </div>
  );
}
