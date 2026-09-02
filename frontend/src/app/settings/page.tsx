'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest, clearAuth } from '@/lib/auth';
import AppNav from '@/components/AppNav';
import PushToggle from '@/components/PushToggle';

interface MeResponse {
  id: string;
  email: string;
  username: string;
  code_prefix: string | null;
  created_at: string;
  notification_prefs: NotificationPrefs;
}

/** Opt-outs. An absent key means on, so {} is "everything". */
type NotificationPrefs = Partial<Record<PrefKey, boolean>>;

type PrefKey =
  | 'app_session_live'
  | 'email_session_live'
  | 'app_channel_prompt'
  | 'app_question_replied';

const NOTIFICATION_SETTINGS: { key: PrefKey; label: string; detail: string }[] = [
  { key: 'app_session_live',     label: 'A channel goes live',
    detail: 'In the app, when a channel you follow starts a session.' },
  { key: 'email_session_live',   label: 'A channel goes live — by email',
    detail: 'The same thing, in your inbox.' },
  { key: 'app_channel_prompt',   label: 'A channel posts to its feed',
    detail: 'In the app, when a channel you follow asks its audience something.' },
  { key: 'app_question_replied', label: 'A host replies to your question',
    detail: 'In the app, when someone answers something you asked.' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Join code prefix
  const [prefs, setPrefs]           = useState<NotificationPrefs>({});
  const [prefSaving, setPrefSaving] = useState<PrefKey | null>(null);
  const [prefMsg, setPrefMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  /**
   * Saves on toggle rather than behind a Save button — there is nothing to
   * review and a half-set form is worse than none. The switch moves first and
   * rolls back if the request fails, so it never shows a state the server did
   * not accept.
   */
  async function togglePref(key: PrefKey) {
    const next = !(prefs[key] ?? true) ? true : false;
    const previous = prefs;
    setPrefs(p => ({ ...p, [key]: next }));
    setPrefSaving(key);
    setPrefMsg(null);
    try {
      const updated = await api.patch<MeResponse>('/auth/me', {
        notification_prefs: { [key]: next },
      });
      setPrefs(updated.notification_prefs ?? {});
    } catch (err: any) {
      setPrefs(previous);
      setPrefMsg({ ok: false, text: err?.message ?? 'Could not save that' });
    } finally {
      setPrefSaving(null);
    }
  }

  const [prefix, setPrefix]         = useState('');
  const [prefixSaving, setPrefixSaving] = useState(false);
  const [prefixMsg, setPrefixMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  // Password
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwMsg, setPwMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  // Account deletion
  const [showDelete, setShowDelete] = useState(false);
  const [deletePw, setDeletePw]     = useState('');
  const [deleting, setDeleting]     = useState(false);
  const [deleteErr, setDeleteErr]   = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) { router.push('/login?next=/settings'); return; }
    api.get<MeResponse>('/auth/me')
      .then(u => { setMe(u); setPrefix(u.code_prefix ?? ''); setPrefs(u.notification_prefs ?? {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  if (!mounted) return null;

  // ── Save prefix ───────────────────────────────────────────────────────────

  async function savePrefix(e: React.FormEvent) {
    e.preventDefault();
    setPrefixSaving(true); setPrefixMsg(null);
    try {
      const updated = await api.patch<MeResponse>('/auth/me', {
        code_prefix: prefix.trim().toUpperCase() || null,
      });
      setMe(updated);
      setPrefix(updated.code_prefix ?? '');
      setPrefixMsg({ ok: true, text: 'Saved!' });
    } catch (err: any) {
      setPrefixMsg({ ok: false, text: err.message });
    } finally {
      setPrefixSaving(false);
      setTimeout(() => setPrefixMsg(null), 3000);
    }
  }

  // ── Change password ───────────────────────────────────────────────────────

  // ── Delete account ────────────────────────────────────────────────────────

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setDeleting(true); setDeleteErr(null);
    try {
      await api.delete('/auth/me', { password: deletePw });
      // Clear local auth before navigating: the token is already dead server-side,
      // and leaving it behind would bounce the next request through /login.
      clearAuth();
      router.push('/?deleted=1');
    } catch (err: any) {
      setDeleteErr(err.message ?? 'Could not delete your account.');
      setDeleting(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return; }
    if (newPw.length < 8)   { setPwMsg({ ok: false, text: 'Password must be at least 8 characters' }); return; }
    setPwSaving(true);
    try {
      await api.patch('/auth/me', { current_password: currentPw, new_password: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg({ ok: true, text: 'Password updated!' });
    } catch (err: any) {
      setPwMsg({ ok: false, text: err.message });
    } finally {
      setPwSaving(false);
      setTimeout(() => setPwMsg(null), 4000);
    }
  }

  // ── Preview join code ─────────────────────────────────────────────────────

  const previewCode = prefix.trim()
    ? `${prefix.trim().toUpperCase().slice(0, 8)}···`
    : '······ (random)';

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors inline-flex items-center min-h-[44px]">Dashboard</Link>} />

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Settings</h1>
          {me && <p className="text-purple-200/70 text-sm mt-0.5">@{me.username} · {me.email}</p>}
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1,2].map(i => <div key={i} className="card p-6 h-40 animate-pulse bg-brand-card/50" />)}
          </div>
        ) : (
          <>
            {/* ── Notifications ───────────────────────────────────────────── */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-1">Notifications</h2>
                <p className="text-purple-200/75 text-sm">
                  Everything is on unless you turn it off. Account emails — password
                  resets and the like — are not affected.
                </p>
              </div>

              <div className="divide-y divide-brand-border/40">
                {NOTIFICATION_SETTINGS.map(({ key, label, detail }) => {
                  const on = prefs[key] ?? true;
                  return (
                    <label
                      key={key}
                      className="flex items-start justify-between gap-4 py-3 cursor-pointer min-h-[44px]"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-white">{label}</span>
                        <span className="block text-xs text-purple-200/70 mt-0.5">{detail}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={label}
                        disabled={prefSaving === key}
                        onClick={() => togglePref(key)}
                        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors mt-0.5
                                    disabled:opacity-50 ${on ? 'bg-brand-orange' : 'bg-brand-border'}`}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform
                                      ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
                        />
                      </button>
                    </label>
                  );
                })}
              </div>

              {prefMsg && (
                <p className={`text-xs ${prefMsg.ok ? 'text-emerald-400' : 'text-red-300'}`}>
                  {prefMsg.text}
                </p>
              )}
            </div>

            {/* ── Join code prefix ─────────────────────────────────────────── */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-1">Join code prefix</h2>
                <p className="text-purple-200/75 text-sm">
                  Audiences type your join code to enter a session. A prefix makes it recognizable — great for radio stations, podcasts, or recurring shows.
                </p>
              </div>

              <form onSubmit={savePrefix} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-1.5">
                    Prefix <span className="text-purple-200/60 font-normal">(2–8 characters, letters and numbers only)</span>
                  </label>
                  <div className="flex gap-3">
                    <input
                      value={prefix}
                      onChange={e => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                      placeholder="e.g. PBOX or TMH"
                      maxLength={8}
                      className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-brand-purple transition-colors font-mono tracking-wider"
                    />
                    <button
                      type="submit"
                      disabled={prefixSaving}
                      className="btn-primary px-5 py-3 text-sm disabled:opacity-40"
                    >
                      {prefixSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                  {/* Live preview */}
                  <div className="mt-3 flex items-center gap-3">
                    <p className="text-xs text-purple-200/70">Your codes will look like:</p>
                    <span className="font-mono text-sm font-bold text-orange-gradient tracking-widest">
                      {previewCode}
                    </span>
                  </div>
                </div>

                {prefix.length === 1 && (
                  <p className="text-xs text-red-400">Prefix must be at least 2 characters</p>
                )}

                {prefixMsg && (
                  <p className={`text-sm font-medium ${prefixMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {prefixMsg.text}
                  </p>
                )}
              </form>

              {me?.code_prefix && (
                <div className="pt-3 border-t border-brand-border/30">
                  <button
                    type="button"
                    onClick={async () => {
                      setPrefix('');
                      setPrefixSaving(true); setPrefixMsg(null);
                      try {
                        const updated = await api.patch<MeResponse>('/auth/me', { code_prefix: null });
                        setMe(updated);
                        setPrefixMsg({ ok: true, text: 'Prefix removed.' });
                      } catch (err: any) {
                        setPrefixMsg({ ok: false, text: err.message });
                      } finally {
                        setPrefixSaving(false);
                        setTimeout(() => setPrefixMsg(null), 3000);
                      }
                    }}
                    className="text-xs text-purple-200/60 hover:text-red-400 transition-colors"
                  >
                    Remove prefix (use random codes)
                  </button>
                </div>
              )}
            </div>

            {/* ── Change password ──────────────────────────────────────────── */}
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-1">Change password</h2>
                <p className="text-purple-200/75 text-sm">You&apos;ll stay logged in on this device.</p>
              </div>

              <form onSubmit={changePassword} className="space-y-3">
                <SettingsField
                  label="Current password"
                  type="password"
                  value={currentPw}
                  onChange={setCurrentPw}
                  placeholder="••••••••"
                />
                <SettingsField
                  label="New password"
                  type="password"
                  value={newPw}
                  onChange={setNewPw}
                  placeholder="8+ characters"
                />
                <SettingsField
                  label="Confirm new password"
                  type="password"
                  value={confirmPw}
                  onChange={setConfirmPw}
                  placeholder="••••••••"
                />

                {pwMsg && (
                  <p className={`text-sm font-medium ${pwMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pwMsg.text}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                  className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40"
                >
                  {pwSaving ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </div>

            <PushToggle />

            {/* Account deletion. Required in-app by App Store Review Guideline
                5.1.1(v), and the route a GDPR erasure request takes. */}
            <div className="card p-6 border-red-500/30">
              <h2 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Delete account</h2>
              <p className="text-sm text-purple-200/75 mb-4">
                This cannot be undone. Your email, username and profile are erased and
                you are signed out everywhere.
              </p>
              <p className="text-sm text-purple-200/60 mb-4">
                Sessions you hosted stay up so the questions people asked in them are
                not lost, but they will no longer show your name.
              </p>

              {!showDelete ? (
                <button
                  type="button"
                  onClick={() => setShowDelete(true)}
                  className="px-5 py-2.5 min-h-[44px] text-sm font-semibold rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Delete my account
                </button>
              ) : (
                <form onSubmit={deleteAccount} className="space-y-4">
                  <SettingsField
                    label="Confirm your password"
                    type="password"
                    value={deletePw}
                    onChange={setDeletePw}
                    placeholder="Your current password"
                  />

                  {deleteErr && <p className="text-sm font-medium text-red-400">{deleteErr}</p>}

                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={deleting || !deletePw}
                      className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-red-500/90 text-white hover:bg-red-500 disabled:opacity-40 transition-colors"
                    >
                      {deleting ? 'Deleting…' : 'Permanently delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowDelete(false); setDeletePw(''); setDeleteErr(null); }}
                      className="text-sm text-purple-200/75 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SettingsField({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-purple-200/85 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3
                   text-white text-sm
                   focus:outline-none focus:border-brand-purple transition-colors"
      />
    </div>
  );
}
