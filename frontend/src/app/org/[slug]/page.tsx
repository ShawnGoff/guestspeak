'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Organization, Session } from '@ask-away/shared/types';
import AppNav from '@/components/AppNav';

interface OrgPageProps {
  params: { slug: string };
}

interface PastSession {
  id: string;
  title: string;
  slug: string;
  status: 'closed';
  city: string | null;
  ends_at: string | null;
  created_at: string;
  host_username: string;
  participant_count: number;
  question_count: number;
}

interface OrgData {
  org: Organization & { follower_count?: number; is_verified?: boolean; caller_role?: string };
  sessions: (Session & { participant_count?: number })[];
  past_sessions: PastSession[];
}

export default function OrgPage({ params }: OrgPageProps) {
  const [data, setData]       = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    api.get<OrgData>(`/orgs/${params.slug}`)
      .then(d => setData(d))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.slug]);

  async function toggleFollow() {
    if (!data) return;
    setFollowLoading(true);
    try {
      if (following) {
        await api.delete(`/orgs/${data.org.id}/follow`);
        setFollowing(false);
      } else {
        await api.post(`/orgs/${data.org.id}/follow`, {});
        setFollowing(true);
      }
    } catch {}
    finally { setFollowLoading(false); }
  }

  if (loading) return <PageSkeleton />;
  if (error || !data) return <NotFound />;

  const { org, sessions, past_sessions } = data;
  const isManager = org.caller_role === 'owner' || org.caller_role === 'admin';
  const live     = sessions.filter(s => s.status === 'live');
  const upcoming = sessions.filter(s => s.status === 'upcoming');

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Nav */}
      <AppNav maxWidth="3xl" right={
        isManager ? (
          <Link href={`/org/${params.slug}/settings`} className="btn-ghost text-sm py-2 px-4">Settings</Link>
        ) : undefined
      } />

      <main className="max-w-3xl mx-auto px-4 py-8">

        {/* Org header */}
        <div className="flex items-start gap-5 mb-8">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-2xl bg-brand-card border border-brand-border flex-shrink-0 flex items-center justify-center overflow-hidden">
            {org.avatar_url ? (
              <img src={org.avatar_url} alt={org.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-extrabold text-orange-gradient">
                {org.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold text-white">{org.name}</h1>
              {org.is_verified && <VerifiedBadge />}
            </div>
            {org.description && (
              <p className="text-purple-200/60 text-sm mt-1 leading-relaxed">{org.description}</p>
            )}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {org.website && (
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-orange/70 hover:text-brand-orange flex items-center gap-1 transition-colors"
                >
                  <LinkIcon />
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              {(org.follower_count ?? 0) > 0 && (
                <span className="text-xs text-purple-200/40">
                  {org.follower_count} {org.follower_count === 1 ? 'follower' : 'followers'}
                </span>
              )}
            </div>
          </div>

          {/* Follow button */}
          <button
            onClick={toggleFollow}
            disabled={followLoading}
            className={`flex-shrink-0 text-sm font-semibold px-4 py-2 rounded-xl border transition-colors ${
              following
                ? 'border-brand-purple bg-brand-purple/20 text-white'
                : 'border-brand-orange text-brand-orange hover:bg-brand-orange/10'
            } disabled:opacity-40`}
          >
            {followLoading ? '…' : following ? 'Following' : 'Follow'}
          </button>
        </div>

        {/* Sessions */}
        {sessions.length === 0 && past_sessions.length === 0 ? (
          <div className="text-center py-16 text-purple-200/40 border border-dashed border-brand-border/30 rounded-2xl">
            <p className="text-3xl mb-3">🎙</p>
            <p className="font-medium">No public sessions yet.</p>
            <p className="text-sm mt-1">Follow to get notified when they go live.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {live.length > 0 && (
              <SessionSection title="Live Now" badge={<LiveBadge />} sessions={live} />
            )}
            {upcoming.length > 0 && (
              <SessionSection title="Upcoming" sessions={upcoming} />
            )}
            {past_sessions.length > 0 && (
              <PastSessionsSection sessions={past_sessions} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Session section ──────────────────────────────────────────────────────────

function SessionSection({ title, badge, sessions }: {
  title: string;
  badge?: React.ReactNode;
  sessions: (Session & { participant_count?: number })[];
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h2>
        {badge}
      </div>
      <div className="space-y-3">
        {sessions.map(s => <OrgSessionCard key={s.id} session={s} />)}
      </div>
    </section>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────

function OrgSessionCard({ session: s }: { session: Session & { participant_count?: number } }) {
  const isLive = s.status === 'live';
  const isLiveSoon = s.status === 'upcoming' && s.starts_at
    && (new Date(s.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  return (
    <Link
      href={`/s/${s.slug}`}
      className="card p-5 flex items-start justify-between gap-4 hover:border-brand-purple/50 transition-colors group"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isLive ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
            </span>
          ) : isLiveSoon ? (
            <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
              Live Soon
            </span>
          ) : null}
        </div>
        <h3 className="font-bold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors">
          {s.title}
        </h3>
        {s.description && (
          <p className="text-purple-200/40 text-xs mt-1 line-clamp-2">{s.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-purple-200/30">
          {s.participant_count ? <span>{s.participant_count} joined</span> : null}
          {s.city && <span>{s.city}</span>}
          {s.starts_at && !isLive && <span>{formatDate(s.starts_at)}</span>}
        </div>
      </div>
      <span className="flex-shrink-0 text-purple-200/30 group-hover:text-brand-orange transition-colors mt-0.5">
        <ChevronRight />
      </span>
    </Link>
  );
}

// ─── Past sessions ────────────────────────────────────────────────────────────

function PastSessionsSection({ sessions }: { sessions: PastSession[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sessions : sessions.slice(0, 3);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Past Sessions</h2>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-brand-border/40 text-purple-200/40 font-mono">
          {sessions.length}
        </span>
      </div>
      <div className="space-y-2">
        {visible.map(s => (
          <Link
            key={s.id}
            href={`/s/${s.slug}`}
            className="card p-4 flex items-center gap-4 hover:border-brand-border/80 transition-colors group opacity-70 hover:opacity-100"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors truncate">
                {s.title}
              </p>
              <div className="flex items-center gap-3 mt-1 text-xs text-purple-200/30">
                {s.ends_at && <span>{new Date(s.ends_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {s.participant_count > 0 && <span>{s.participant_count} attended</span>}
                {s.question_count > 0 && <span>{s.question_count} questions</span>}
              </div>
            </div>
            <ChevronRight />
          </Link>
        ))}
      </div>
      {sessions.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs text-purple-200/40 hover:text-brand-orange transition-colors"
        >
          {expanded ? 'Show less' : `Show ${sessions.length - 3} more →`}
        </button>
      )}
    </section>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        <div className="flex gap-5">
          <div className="w-16 h-16 rounded-2xl bg-brand-card animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-6 bg-brand-card rounded animate-pulse w-1/3" />
            <div className="h-4 bg-brand-card rounded animate-pulse w-2/3" />
          </div>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-5 h-24 animate-pulse bg-brand-card/50" />
        ))}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="text-center card p-8 max-w-sm">
        <p className="text-4xl mb-3">🔍</p>
        <h2 className="text-white font-bold text-lg mb-2">Organization not found</h2>
        <p className="text-purple-200/50 text-sm mb-6">This page doesn't exist or has been removed.</p>
        <Link href="/discover" className="btn-primary">Browse sessions</Link>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Live
    </span>
  );
}

function VerifiedBadge() {
  return (
    <span title="Verified organization" className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-orange text-white flex-shrink-0">
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function LinkIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
