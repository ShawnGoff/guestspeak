'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest } from '@/lib/auth';
import AppNav from '@/components/AppNav';

interface MySession {
  id: string;
  title: string;
  slug: string;
  status: 'upcoming' | 'live' | 'closed';
  visibility: 'public' | 'unlisted' | 'private';
  join_code: string;
  starts_at: string | null;
  created_at: string;
  participant_count: number;
  question_count: number;
  org_name: string | null;
}

type Filter = 'all' | 'live' | 'upcoming' | 'closed';

export default function MySessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<MySession[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<Filter>('all');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn() || isGuest()) { router.push('/login?next=/sessions/mine'); return; }
    api.get<{ sessions: MySession[] }>('/sessions/mine')
      .then(r => setSessions(r.sessions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  async function deleteSession(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      alert(err.message ?? 'Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = filter === 'all' ? sessions : sessions.filter(s => s.status === filter);

  const counts = {
    all:      sessions.length,
    live:     sessions.filter(s => s.status === 'live').length,
    upcoming: sessions.filter(s => s.status === 'upcoming').length,
    closed:   sessions.filter(s => s.status === 'closed').length,
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all',      label: `All (${counts.all})` },
    { value: 'live',     label: `Live (${counts.live})` },
    { value: 'upcoming', label: `Upcoming (${counts.upcoming})` },
    { value: 'closed',   label: `Archived (${counts.closed})` },
  ];

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav maxWidth="3xl" />

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-white">My Sessions</h1>
            <p className="text-purple-200/70 text-sm mt-0.5">All sessions you&apos;ve hosted.</p>
          </div>
          <Link href="/create" className="btn-primary text-sm py-2 px-4">+ New session</Link>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 p-1 bg-brand-card rounded-xl border border-brand-border mb-6">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === f.value ? 'bg-brand-purple text-white' : 'text-purple-200/75 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="card p-4 h-20 animate-pulse bg-brand-card/50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-4">🎙</p>
            <p className="text-white font-semibold mb-2">
              {filter === 'all' ? 'No sessions yet' : `No ${filter} sessions`}
            </p>
            {filter === 'all' && (
              <Link href="/create" className="btn-primary mt-4 inline-block py-2.5 px-6">
                Create your first session
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                onCopy={copyCode}
                copiedCode={copiedCode}
                onDelete={deleteSession}
                isDeleting={deletingId === s.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────

function SessionRow({ session: s, onCopy, copiedCode, onDelete, isDeleting }: {
  session: MySession;
  onCopy: (code: string) => void;
  copiedCode: string | null;
  onDelete: (id: string, title: string) => void;
  isDeleting: boolean;
}) {
  const copied = copiedCode === s.join_code;

  return (
    <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <StatusBadge status={s.status} />
          {s.org_name && <span className="text-xs text-purple-200/70">{s.org_name}</span>}
          {s.visibility !== 'public' && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-brand-border/50 text-purple-200/60">
              {s.visibility}
            </span>
          )}
        </div>
        <Link href={`/s/${s.slug}`} className="font-bold text-white hover:text-brand-amber transition-colors line-clamp-1">
          {s.title}
        </Link>
        <div className="flex items-center gap-4 mt-1 text-xs text-purple-200/70">
          <span>{s.participant_count} joined</span>
          <span>{s.question_count} questions</span>
          {s.starts_at && s.status !== 'live' && (
            <span>{new Date(s.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          )}
          {s.status === 'closed' && !s.starts_at && (
            <span>Created {new Date(s.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {s.status !== 'closed' && (
          <button
            onClick={() => onCopy(s.join_code)}
            className={`flex items-center gap-1.5 font-mono text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              copied
                ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                : 'border-brand-border text-white hover:border-brand-purple'
            }`}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {s.join_code}
          </button>
        )}
        <Link
          href={`/s/${s.slug}`}
          className="btn-ghost text-sm py-1.5 px-3"
        >
          {s.status === 'live' ? 'Manage' : s.status === 'closed' ? 'View' : 'Preview'}
        </Link>
        {s.status === 'closed' && (
          <button
            onClick={() => onDelete(s.id, s.title)}
            disabled={isDeleting}
            title="Delete session"
            className="text-purple-200/60 hover:text-red-400 transition-colors disabled:opacity-40 p-1.5"
          >
            {isDeleting ? <span className="text-xs">…</span> : <TrashIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Badges & icons ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MySession['status'] }) {
  if (status === 'live') return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
    </span>
  );
  if (status === 'upcoming') return (
    <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">Upcoming</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/70 text-xs font-semibold">Archived</span>
  );
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
