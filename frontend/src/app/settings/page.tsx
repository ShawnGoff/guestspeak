'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import AppNav from '@/components/AppNav';

interface MeResponse {
  id: string;
  email: string;
  username: string;
  code_prefix: string | null;
  created_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Join code prefix
  const [prefix, setPrefix]         = useState('');
  const [prefixSaving, setPrefixSaving] = useState(false);
  const [prefixMsg, setPrefixMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  // Password
  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwMsg, setPwMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn()) { router.push('/login?next=/settings'); return; }
    api.get<MeResponse>('/auth/me')
      .then(u => { setMe(u); setPrefix(u.code_prefix ?? ''); })
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
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>} />

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
                      placeholder="e.g. KGMZ or HDTGM"
                      maxLength={8}
                      className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-sm
                                 placeholder-brand-border/50 focus:outline-none focus:border-brand-purple transition-colors font-mono tracking-wider"
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
                   text-white text-sm placeholder-brand-border/50
                   focus:outline-none focus:border-brand-purple transition-colors"
      />
    </div>
  );
}
