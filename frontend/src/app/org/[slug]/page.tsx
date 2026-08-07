'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, resolveAsset } from '@/lib/api';
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

interface Contributor {
  user_id: string;
  username: string;
  question_count: number;
  total_echoes: number;
}

interface QuestionHighlight {
  id: string;
  text: string;
  vote_count: number;
  is_answered: boolean;
  session_title: string;
  session_slug: string;
  author_username: string;
}

interface OrgStats {
  total_sessions: number;
  total_participants: number;
  total_questions: number;
  total_echoes: number;
}

interface OrgData {
  org: Organization & { follower_count?: number; is_verified?: boolean; caller_role?: string };
  sessions: (Session & { participant_count?: number })[];
  past_sessions: PastSession[];
  stats: OrgStats;
  top_contributors: Contributor[];
  question_highlights: QuestionHighlight[];
}

export default function OrgPage({ params }: OrgPageProps) {
  const [data, setData]           = useState<OrgData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
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

  const { org, sessions, past_sessions, stats, top_contributors, question_highlights } = data;
  const isManager = org.caller_role === 'owner' || org.caller_role === 'admin';
  const live     = sessions.filter(s => s.status === 'live');
  const upcoming = sessions.filter(s => s.status !== 'live');
  const hasContent = sessions.length > 0 || past_sessions.length > 0;

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav maxWidth="3xl" right={
        isManager ? (
          <Link href={`/org/${params.slug}/settings`} className="btn-ghost text-sm py-2 px-4">Settings</Link>
        ) : undefined
      } />

      {/* Live now banner */}
      {live.length > 0 && (
        <div className="bg-red-500/10 border-b border-red-500/20">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-500/20 border border-red-500/30 px-2.5 py-1 rounded-full shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                LIVE NOW
              </span>
              <p className="text-white font-semibold text-sm truncate">{live[0].title}</p>
            </div>
            <Link
              href={`/s/${live[0].slug}`}
              className="btn-primary text-xs py-2 px-4 shrink-0"
            >
              Join →
            </Link>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-10">

        {/* Channel header */}
        <div>
          <div className="flex items-start gap-5 mb-5">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-brand-card border border-brand-border flex-shrink-0 flex items-center justify-center overflow-hidden">
              {org.avatar_url ? (
                <img src={resolveAsset(org.avatar_url)} alt={org.name} className="w-full h-full object-cover" />
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
                <p className="text-purple-200/85 text-sm mt-1 leading-relaxed">{org.description}</p>
              )}
              {org.website && (
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-orange/70 hover:text-brand-orange transition-colors mt-2"
                >
                  <LinkIcon />
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {isManager && (
                <Link
                  href={`/org/${params.slug}/settings`}
                  className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl border border-brand-border text-purple-200/75 hover:text-white hover:border-brand-purple/60 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Edit
                </Link>
              )}
              <button
                onClick={toggleFollow}
                disabled={followLoading}
                className={`text-sm font-semibold px-4 py-2 rounded-xl border transition-colors ${
                  following
                    ? 'border-brand-purple bg-brand-purple/20 text-white'
                    : 'border-brand-orange text-brand-orange hover:bg-brand-orange/10'
                } disabled:opacity-40`}
              >
                {followLoading ? '…' : following ? 'Following' : 'Follow'}
              </button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Followers',    value: org.follower_count ?? 0 },
              { label: 'Sessions',     value: stats.total_sessions },
              { label: 'Questions',    value: stats.total_questions },
              { label: 'Echoes',       value: stats.total_echoes },
            ].map(({ label, value }) => (
              <div key={label} className="card p-3 text-center">
                <p className="text-lg font-extrabold text-white">{fmtNum(value)}</p>
                <p className="text-[10px] text-purple-200/70 uppercase tracking-wider mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* No content empty state */}
        {!hasContent && (
          <div className="text-center py-16 text-purple-200/70 border border-dashed border-brand-border/30 rounded-2xl">
            <p className="text-3xl mb-3">🎙</p>
            <p className="font-medium text-white/60">No public sessions yet.</p>
            <p className="text-sm mt-1">Follow to get notified when they go live.</p>
          </div>
        )}

        {/* Upcoming schedule */}
        {upcoming.length > 0 && (
          <section>
            <SectionHeader title="Upcoming" />
            <div className="space-y-3">
              {upcoming.map(s => <UpcomingCard key={s.id} session={s} />)}
            </div>
          </section>
        )}

        {/* Past sessions */}
        {past_sessions.length > 0 && (
          <PastSessionsSection sessions={past_sessions} />
        )}

        {/* Question highlights */}
        {question_highlights.length > 0 && (
          <section>
            <SectionHeader title="Top Questions" subtitle="Highest-voted questions from past sessions" />
            <div className="space-y-3">
              {question_highlights.map(q => (
                <Link
                  key={q.id}
                  href={`/s/${q.session_slug}`}
                  className="card p-5 block hover:border-brand-purple/50 transition-colors group"
                >
                  <div className="flex gap-3">
                    {/* Echo count */}
                    <div className="flex flex-col items-center shrink-0 pt-0.5">
                      <div className="w-8 h-8 rounded-lg bg-brand-orange/15 border border-brand-orange/20 flex items-center justify-center text-brand-orange text-xs font-bold">
                        ↑
                      </div>
                      <span className="text-xs font-bold text-brand-amber tabular-nums mt-1">{q.vote_count}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm leading-relaxed group-hover:text-brand-amber transition-colors">
                        {q.text}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] text-purple-200/60">@{q.author_username}</span>
                        <span className="text-purple-200/50">·</span>
                        <span className="text-[10px] text-purple-200/60 truncate">{q.session_title}</span>
                        {q.is_answered && (
                          <>
                            <span className="text-purple-200/50">·</span>
                            <span className="text-[10px] text-green-400/70 font-medium">Answered</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Top contributors */}
        {top_contributors.length > 0 && (
          <section>
            <SectionHeader title="Top Contributors" subtitle="Most active voices in this channel" />
            <div className="card divide-y divide-brand-border/30">
              {top_contributors.map((c, i) => (
                <div key={c.user_id} className="flex items-center gap-4 px-4 py-3">
                  {/* Rank */}
                  <span className={`text-xs font-bold tabular-nums w-5 text-center shrink-0 ${
                    i === 0 ? 'text-brand-amber' : i === 1 ? 'text-purple-200/85' : 'text-purple-200/60'
                  }`}>
                    {i + 1}
                  </span>
                  {/* Avatar initial */}
                  <div className="w-8 h-8 rounded-full bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center text-xs font-bold text-brand-amber shrink-0">
                    {c.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">@{c.username}</p>
                    <p className="text-[10px] text-purple-200/60 mt-0.5">
                      {c.question_count} {c.question_count === 1 ? 'question' : 'questions'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-brand-orange">{fmtNum(c.total_echoes)}</p>
                    <p className="text-[10px] text-purple-200/60">echoes</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </main>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h2>
      {subtitle && <p className="text-xs text-purple-200/70 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function UpcomingCard({ session: s }: { session: Session & { participant_count?: number } }) {
  const isLive     = s.status === 'live';
  const isLiveSoon = s.status === 'upcoming' && s.starts_at
    && (new Date(s.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  return (
    <Link
      href={`/s/${s.slug}`}
      className="card p-5 flex items-start gap-4 hover:border-brand-purple/50 transition-colors group"
    >
      {/* Date block */}
      {s.starts_at ? (
        <div className="shrink-0 w-12 text-center">
          <p className="text-[10px] text-purple-200/70 uppercase tracking-wider">
            {new Date(s.starts_at).toLocaleDateString([], { month: 'short' })}
          </p>
          <p className="text-xl font-extrabold text-white leading-none">
            {new Date(s.starts_at).getDate()}
          </p>
          <p className="text-[10px] text-purple-200/70 mt-0.5">
            {new Date(s.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      ) : (
        <div className="shrink-0 w-12 text-center">
          <p className="text-lg">📅</p>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isLive ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
            </span>
          ) : isLiveSoon ? (
            <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
              Live soon
            </span>
          ) : null}
        </div>
        <h3 className="font-bold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors">
          {s.title}
        </h3>
        {s.description && (
          <p className="text-purple-200/70 text-xs mt-1 line-clamp-2">{s.description}</p>
        )}
        {s.city && <p className="text-xs text-purple-200/60 mt-1.5">📍 {s.city}</p>}
      </div>

      <ChevronRight />
    </Link>
  );
}

function PastSessionsSection({ sessions }: { sessions: PastSession[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sessions : sessions.slice(0, 4);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Archive</h2>
          <p className="text-xs text-purple-200/70 mt-0.5">{sessions.length} past {sessions.length === 1 ? 'session' : 'sessions'}</p>
        </div>
      </div>
      <div className="card divide-y divide-brand-border/30">
        {visible.map(s => (
          <Link
            key={s.id}
            href={`/s/${s.slug}`}
            className="flex items-center gap-4 px-4 py-3.5 hover:bg-brand-border/10 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white/80 text-sm leading-snug group-hover:text-brand-amber transition-colors truncate">
                {s.title}
              </p>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-purple-200/60">
                {s.ends_at && (
                  <span>{new Date(s.ends_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
                {s.participant_count > 0 && <span>{fmtNum(s.participant_count)} attended</span>}
                {s.question_count > 0 && <span>{s.question_count} questions</span>}
              </div>
            </div>
            <ChevronRight />
          </Link>
        ))}
      </div>
      {sessions.length > 4 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs text-purple-200/70 hover:text-brand-orange transition-colors"
        >
          {expanded ? 'Show less' : `Show ${sessions.length - 4} more →`}
        </button>
      )}
    </section>
  );
}

// ─── Skeleton / error ─────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex gap-5">
          <div className="w-16 h-16 rounded-2xl bg-brand-card animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-6 bg-brand-card rounded animate-pulse w-1/3" />
            <div className="h-4 bg-brand-card rounded animate-pulse w-2/3" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-3 h-14 animate-pulse bg-brand-card/50" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-5 h-20 animate-pulse bg-brand-card/50" />
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
        <h2 className="text-white font-bold text-lg mb-2">Channel not found</h2>
        <p className="text-purple-200/75 text-sm mb-6">This page doesn&apos;t exist or has been removed.</p>
        <Link href="/discover" className="btn-primary">Browse sessions</Link>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Icons ───────────────────────────────────────────────────────────────────

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
    <svg className="w-4 h-4 text-purple-200/60 group-hover:text-brand-orange transition-colors shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
