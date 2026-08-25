'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest } from '@/lib/auth';
import AppNav from '@/components/AppNav';
import SessionCard, { type MySession } from '@/components/SessionCard';

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
              className={`flex-1 py-1.5 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
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
              <SessionCard
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
