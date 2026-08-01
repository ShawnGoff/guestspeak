'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlagRow {
  flag_id: string;
  reason: string;
  is_moderator_flag: boolean;
  flagged_at: string;
  flag_count: number;
  question_id: string;
  body: string;
  status: string;
  session_id: string;
  session_title: string;
  session_slug: string;
  author_username?: string;
  participant_id?: string;
}

interface BanRow {
  id: string;
  user_id?: string;
  guest_token?: string;
  ip_address?: string;
  reason: string;
  expires_at?: string;
  banned_at: string;
  banned_username?: string;
  banned_by_username: string;
}

interface WordRow {
  id: number;
  word: string;
  added_at: string;
  added_by_username?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Badge({ children, color = 'purple' }: { children: React.ReactNode; color?: 'red' | 'amber' | 'purple' | 'green' }) {
  const cls = {
    red:    'bg-red-500/15 text-red-400 border-red-500/25',
    amber:  'bg-amber-500/15 text-amber-400 border-amber-500/25',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
    green:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  }[color];
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
}

// ─── Flags tab ────────────────────────────────────────────────────────────────

function FlagsTab() {
  const [flags, setFlags]   = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ data: FlagRow[] }>('/admin/flags?limit=100');
      setFlags(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function hideQuestion(questionId: string) {
    await api.patch(`/questions/${questionId}/status`, { status: 'hidden' });
    setFlags(prev => prev.filter(f => f.question_id !== questionId));
  }

  async function revealIdentity(questionId: string) {
    const data = await api.get<Record<string, string>>(`/admin/questions/${questionId}/identity`);
    alert(`Author: ${data.username ?? data.guest_username ?? 'unknown'}\nEmail: ${data.email ?? '—'}\nGuest token: ${data.guest_token ?? '—'}`);
  }

  if (loading) return <p className="text-purple-200/40 py-10 text-center">Loading…</p>;
  if (!flags.length) return <p className="text-purple-200/40 py-10 text-center">No flagged questions.</p>;

  // Dedupe by question_id, keep highest flag_count
  const seen = new Set<string>();
  const unique = flags.filter(f => { if (seen.has(f.question_id)) return false; seen.add(f.question_id); return true; });

  return (
    <div className="space-y-3">
      {unique.map(f => (
        <div key={f.flag_id} className="card p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="red">{f.flag_count} {f.flag_count === 1 ? 'flag' : 'flags'}</Badge>
              <Badge color="amber">{f.reason}</Badge>
              {f.is_moderator_flag && <Badge color="purple">mod flag</Badge>}
              <Badge color={f.status === 'hidden' ? 'green' : 'purple'}>{f.status}</Badge>
            </div>
            <span className="text-xs text-purple-200/30 shrink-0">{fmt(f.flagged_at)}</span>
          </div>

          <p className="text-white text-sm leading-relaxed mb-2">"{f.body}"</p>

          <div className="flex items-center gap-2 text-xs text-purple-200/40 mb-3 flex-wrap">
            {f.author_username && <span>by {f.author_username}</span>}
            <span>·</span>
            <Link href={`/s/${f.session_slug}`} className="hover:text-brand-amber transition-colors">
              {f.session_title}
            </Link>
          </div>

          <div className="flex gap-2 flex-wrap">
            {f.status !== 'hidden' && (
              <button
                onClick={() => hideQuestion(f.question_id)}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Hide question
              </button>
            )}
            <button
              onClick={() => revealIdentity(f.question_id)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-purple-200/60 hover:text-white transition-colors"
            >
              Reveal identity
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Bans tab ─────────────────────────────────────────────────────────────────

function BansTab() {
  const [bans, setBans]     = useState<BanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm]     = useState({ user_id: '', guest_token: '', reason: '', expires_at: '' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ data: BanRow[] }>('/admin/bans?limit=100');
      setBans(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitBan(e: React.FormEvent) {
    e.preventDefault();
    if (!form.reason.trim() || (!form.user_id.trim() && !form.guest_token.trim())) return;
    setAdding(true);
    try {
      await api.post('/admin/bans', {
        ...(form.user_id.trim()     && { user_id: form.user_id.trim() }),
        ...(form.guest_token.trim() && { guest_token: form.guest_token.trim() }),
        reason: form.reason.trim(),
        ...(form.expires_at && { expires_at: new Date(form.expires_at).toISOString() }),
      });
      setForm({ user_id: '', guest_token: '', reason: '', expires_at: '' });
      load();
    } finally { setAdding(false); }
  }

  async function liftBan(id: string) {
    if (!confirm('Lift this ban?')) return;
    await api.delete(`/admin/bans/${id}`);
    setBans(prev => prev.filter(b => b.id !== id));
  }

  return (
    <div className="space-y-6">
      {/* Create ban form */}
      <div className="card p-5">
        <h3 className="font-bold text-white mb-4">Issue platform ban</h3>
        <form onSubmit={submitBan} className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-purple-200/50 mb-1">User ID (UUID)</label>
              <input value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                placeholder="uuid" className="input w-full text-sm py-2" />
            </div>
            <div>
              <label className="block text-xs text-purple-200/50 mb-1">Guest token</label>
              <input value={form.guest_token} onChange={e => setForm(f => ({ ...f, guest_token: e.target.value }))}
                placeholder="token" className="input w-full text-sm py-2" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-purple-200/50 mb-1">Reason <span className="text-red-400">*</span></label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Reason for ban" className="input w-full text-sm py-2" required />
          </div>
          <div>
            <label className="block text-xs text-purple-200/50 mb-1">Expires (leave blank for permanent)</label>
            <input type="datetime-local" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))}
              className="input w-full text-sm py-2" />
          </div>
          <button type="submit" disabled={adding}
            className="btn-primary text-sm py-2 px-5 disabled:opacity-50">
            {adding ? 'Banning…' : 'Issue ban'}
          </button>
        </form>
      </div>

      {/* Active bans list */}
      {loading ? <p className="text-purple-200/40 text-center py-6">Loading…</p> : (
        <div className="space-y-3">
          {bans.length === 0 && <p className="text-purple-200/40 text-center py-6">No active bans.</p>}
          {bans.map(b => (
            <div key={b.id} className="card p-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {b.banned_username && <span className="font-semibold text-white text-sm">{b.banned_username}</span>}
                  {b.guest_token && <Badge color="amber">guest</Badge>}
                  {!b.expires_at && <Badge color="red">permanent</Badge>}
                  {b.expires_at && <Badge color="amber">expires {fmt(b.expires_at)}</Badge>}
                </div>
                <p className="text-purple-200/60 text-sm">{b.reason}</p>
                <p className="text-purple-200/30 text-xs mt-1">
                  Banned by {b.banned_by_username} · {fmt(b.banned_at)}
                </p>
              </div>
              <button onClick={() => liftBan(b.id)}
                className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-purple-200/50 hover:text-white transition-colors">
                Lift ban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Word list tab ────────────────────────────────────────────────────────────

function WordsTab() {
  const [words, setWords]   = useState<WordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setWords(await api.get<WordRow[]>('/admin/banned-words')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addWord(e: React.FormEvent) {
    e.preventDefault();
    if (!newWord.trim()) return;
    setAdding(true);
    try {
      await api.post('/admin/banned-words', { word: newWord.trim() });
      setNewWord('');
      load();
    } finally { setAdding(false); }
  }

  async function removeWord(id: number) {
    if (!confirm('Remove this word from the filter?')) return;
    await api.delete(`/admin/banned-words/${id}`);
    setWords(prev => prev.filter(w => w.id !== id));
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h3 className="font-bold text-white mb-3">Add word to filter</h3>
        <form onSubmit={addWord} className="flex gap-2">
          <input value={newWord} onChange={e => setNewWord(e.target.value)}
            placeholder="Canonical form (lowercase, no substitutions)"
            className="input flex-1 text-sm py-2" required />
          <button type="submit" disabled={adding} className="btn-primary text-sm px-5 disabled:opacity-50">
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
        <p className="text-purple-200/30 text-xs mt-2">
          Enter the plain form — the filter handles leet-speak and spacing automatically.
        </p>
      </div>

      {loading ? <p className="text-purple-200/40 text-center py-6">Loading…</p> : (
        <div className="card divide-y divide-brand-border/30">
          {words.length === 0 && <p className="text-purple-200/40 text-center py-6">No words in filter yet.</p>}
          {words.map(w => (
            <div key={w.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div>
                <span className="font-mono text-white text-sm">{w.word}</span>
                <span className="text-purple-200/30 text-xs ml-3">
                  Added {fmt(w.added_at)}{w.added_by_username ? ` by ${w.added_by_username}` : ''}
                </span>
              </div>
              <button onClick={() => removeWord(w.id)}
                className="text-xs text-red-400/60 hover:text-red-400 transition-colors">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'flags' | 'bans' | 'words';

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab]       = useState<Tab>('flags');
  const [checking, setChecking] = useState(true);
  const [admin, setAdmin]   = useState<{ username: string } | null>(null);

  useEffect(() => {
    api.get<{ username: string }>('/admin/me')
      .then(setAdmin)
      .catch(() => router.replace('/login'))
      .finally(() => setChecking(false));
  }, [router]);

  if (checking) return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <p className="text-purple-200/40">Verifying access…</p>
    </div>
  );

  if (!admin) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'flags', label: 'Flagged content' },
    { id: 'bans',  label: 'Platform bans' },
    { id: 'words', label: 'Word filter' },
  ];

  return (
    <div className="min-h-screen bg-brand-bg text-white">
      {/* Header */}
      <header className="border-b border-brand-border/50 bg-brand-bg/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-display font-bold text-lg">
              Guest<span className="text-brand-orange">Speak</span>
            </Link>
            <span className="text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full tracking-wider">
              ADMIN
            </span>
          </div>
          <span className="text-xs text-purple-200/40">{admin.username}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-2xl font-extrabold text-white mb-6">Moderation panel</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-brand-border/40 pb-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors ${
                tab === t.id
                  ? 'text-white bg-brand-card border border-brand-border/60 border-b-brand-card -mb-px'
                  : 'text-purple-200/40 hover:text-purple-200/70'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'flags' && <FlagsTab />}
        {tab === 'bans'  && <BansTab />}
        {tab === 'words' && <WordsTab />}
      </main>
    </div>
  );
}
