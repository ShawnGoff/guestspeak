'use client';

import { useState, useEffect } from 'react';
import { plural } from '@/lib/plural';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, resolveAsset } from '@/lib/api';
import { getUser, clearAuth, isLoggedIn, isGuest } from '@/lib/auth';
import type { DiscoverResponse, Session } from '@ask-away/shared/types';
import SessionCard, { StatusBadge, formatDate, type MySession } from '@/components/SessionCard';
import ChannelAvatar from '@/components/ChannelAvatar';

interface MyOrg {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  role: 'owner' | 'admin';
}

interface DiscoverOrg {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  city: string | null;
  description: string | null;
  is_online: boolean;
  member_count: number;
}

interface AttendedSession {
  id: string;
  title: string;
  slug: string;
  status: 'upcoming' | 'live' | 'closed';
  created_at: string;
  starts_at: string | null;
  host_username: string;
  question_count: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions]         = useState<MySession[]>([]);
  const [attendedSessions, setAttendedSessions] = useState<AttendedSession[]>([]);
  const [orgs, setOrgs]                 = useState<MyOrg[]>([]);
  const [discover, setDiscover]         = useState<DiscoverResponse | null>(null);
  const [discoverOrgs, setDiscoverOrgs] = useState<DiscoverOrg[] | null>(null);
  const [loading, setLoading]           = useState(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining]   = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const user = mounted ? getUser() : null;

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) { router.push('/login?next=/dashboard'); return; }
    Promise.all([
      api.get<{ sessions: MySession[] }>('/sessions/mine')
        .then(s => setSessions(s.sessions))
        .catch(() => {}),
      api.get<{ orgs: MyOrg[] }>('/orgs/mine')
        .then(o => setOrgs(o.orgs))
        .catch(() => {}),
      api.get<{ sessions: AttendedSession[] }>('/sessions/attended')
        .then(r => setAttendedSessions(r.sessions))
        .catch(() => {}),
    ]).finally(() => setLoading(false));

    // Discover feed — try geolocation silently, fall back to global
    const fetchDiscover = (lat?: number, lng?: number) => {
      const params = new URLSearchParams();
      if (lat !== undefined && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      }
      api.get<DiscoverResponse>(`/discover?${params}`)
        .then(setDiscover)
        .catch(() => setDiscover({ live_now: [], featured: [], nearby: [], following: [] }));
      api.get<{ orgs: DiscoverOrg[] }>('/orgs/search?limit=6')
        .then(r => setDiscoverOrgs(r.orgs ?? []))
        .catch(() => setDiscoverOrgs([]));
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => fetchDiscover(pos.coords.latitude, pos.coords.longitude),
        ()  => fetchDiscover(),
        { timeout: 5000 },
      );
    } else {
      fetchDiscover();
    }
  }, [router]);

  if (!mounted) return null;

  function handleSignOut() {
    clearAuth();
    router.push('/');
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true); setJoinError(null);
    try {
      const session = await api.get<{ slug: string }>(`/sessions/code/${joinCode.trim().toUpperCase()}`);
      router.push(`/s/${session.slug}`);
    } catch (err: any) {
      setJoinError(err.message ?? 'That code didn\'t match a session.');
    } finally {
      setJoining(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  const live     = sessions.filter(s => s.status === 'live');
  const upcoming = sessions.filter(s => s.status === 'upcoming');
  const archivedCount = sessions.filter(s => s.status === 'closed').length;

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Nav */}
      <nav className="sticky top-0 z-40 bg-brand-bg/90 backdrop-blur border-b border-brand-border/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-5 flex-shrink-0">
            <Link href="/" className="text-lg sm:text-xl font-bold tracking-tight text-white inline-flex items-center min-h-[44px]">Guest<span className="text-brand-orange">Speak</span></Link>
            <Link href="/discover" className="text-sm font-medium text-purple-200/75 hover:text-white transition-colors hidden sm:block">Discover</Link>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm text-purple-200/90 hidden sm:block">@{user?.username}</span>

            {/* Join code — hidden on mobile */}
            <form onSubmit={handleJoin} className="hidden sm:flex items-center gap-1.5">
              <input
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
                placeholder="Join code"
                maxLength={10}
                className="w-28 bg-brand-card border border-brand-border rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-brand-purple transition-colors"
              />
              <button
                type="submit"
                disabled={joining || !joinCode.trim()}
                className="text-sm text-brand-orange hover:text-brand-amber disabled:opacity-30 transition-colors font-medium"
              >
                {joining ? '…' : 'Join →'}
              </button>
            </form>

            <Link href="/create" className="btn-primary text-sm py-2 px-4">+ New session</Link>
            <Link href="/search" className="text-sm text-purple-200/90 hover:text-white transition-colors hidden sm:block">Find people</Link>
            <Link href="/settings" className="text-sm text-purple-200/90 hover:text-white transition-colors hidden sm:block">Settings</Link>
            <button onClick={handleSignOut} className="text-sm text-purple-200/90 hover:text-white transition-colors hidden sm:block">
              Sign out
            </button>
          </div>
        </div>
        {joinError && (
          <div className="max-w-5xl mx-auto px-4 pb-2">
            <p className="text-xs text-red-400">{joinError}</p>
          </div>
        )}
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-10 pb-24 sm:pb-10">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-extrabold text-white">Dashboard</h1>
            <p className="text-purple-200/75 text-sm mt-0.5">Everything you host, in one place.</p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <Link href="/org/new" className="btn-ghost py-2.5 px-4 text-sm">+ New channel</Link>
            <Link href="/create" className="btn-primary py-2.5 px-4 text-sm">+ Create session</Link>
          </div>
        </div>

        {loading ? (
          <DashboardSkeleton />
        ) : (
          <div className="space-y-10">
            {/* Sessions first — the reason a host opens this page mid-show.
                Closed sessions are not rendered here at all; they collapse into the
                "N archived" pill, so an archive that grows for months costs no
                vertical space and cannot push the channels off screen. */}
            {sessions.length === 0 ? (
              <EmptyState />
            ) : (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">My Sessions</h2>
                  <Link href="/sessions/mine" className="text-xs text-purple-200/70 hover:text-brand-orange transition-colors flex items-center gap-1 min-h-[44px] px-1">
                    {archivedCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-brand-border/40 font-mono">{archivedCount} archived</span>}
                    View all →
                  </Link>
                </div>
                {live.length > 0 && (
                  <SessionGroup title="Live" sessions={live} onCopy={copyCode} copiedCode={copiedCode} />
                )}
                {upcoming.length > 0 && (
                  <SessionGroup title="Upcoming" sessions={upcoming} onCopy={copyCode} copiedCode={copiedCode} />
                )}
                {live.length === 0 && upcoming.length === 0 && (
                  <p className="text-sm text-purple-200/70 py-4">
                    Nothing live or upcoming right now. <Link href="/create" className="text-brand-orange hover:text-brand-amber">Start a session →</Link>
                  </p>
                )}
              </section>
            )}

            {/* Channels, below sessions deliberately: a channel is configuration you
                set up once, a session is what you are running right now. With four
                channels the live session sat about 1,180px down the page. */}
            <section>
              <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-3">My Channels</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {orgs.map(org => (
                  <Link
                    key={org.id}
                    href={`/org/${org.slug}`}
                    className="card p-4 flex items-center gap-3 hover:border-brand-purple transition-colors group"
                  >
                    <ChannelAvatar
                      name={org.name}
                      src={org.avatar_url}
                      className="w-10 h-10 rounded-xl"
                      textClassName="text-sm"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-white text-sm truncate">{org.name}</p>
                      <p className="text-xs text-purple-200/70 capitalize">{org.role}</p>
                    </div>
                    <ChevronRightIcon className="ml-auto text-purple-200/50 group-hover:text-brand-orange transition-colors flex-shrink-0" />
                  </Link>
                ))}
                <Link
                  href="/org/new"
                  className="card p-4 flex items-center gap-3 border-dashed hover:border-brand-purple transition-colors group"
                >
                  <div className="w-10 h-10 rounded-xl border border-dashed border-brand-border flex items-center justify-center flex-shrink-0 text-purple-200/60 group-hover:border-brand-purple group-hover:text-brand-purple transition-colors">
                    <PlusIcon />
                  </div>
                  <p className="text-sm text-purple-200/70 group-hover:text-white transition-colors">New channel</p>
                </Link>
              </div>
            </section>

            {/* Recently attended */}
            {attendedSessions.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Recently Attended</h2>
                <div className="space-y-3">
                  {attendedSessions.map(s => (
                    <div key={s.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <StatusBadge status={s.status} />
                        </div>
                        <Link href={`/s/${s.slug}`} className="block truncate py-2.5 -my-1 font-bold text-white hover:text-brand-amber transition-colors">
                          {s.title}
                        </Link>
                        <div className="flex items-center gap-4 mt-1 text-xs text-purple-200/70">
                          <span>@{s.host_username}</span>
                          {s.question_count > 0 && <span>{plural(s.question_count, 'question')} asked</span>}
                          <span>{formatDate(s.created_at)}</span>
                        </div>
                      </div>
                      <Link href={`/s/${s.slug}`} className="btn-ghost text-sm py-1.5 px-3 flex-shrink-0">
                        {s.status === 'live' ? 'Rejoin' : 'View'}
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Discover feed */}
            <DiscoverFeed data={discover} orgs={discoverOrgs} />
          </div>
        )}
      </main>

      {/* Mobile footer nav — visible on small screens only */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-brand-bg/95 backdrop-blur border-t border-brand-border/50 flex items-center justify-around px-4 py-2 z-40">
        <Link href="/search" className="flex flex-col items-center justify-center gap-0.5 text-purple-200/85 hover:text-white transition-colors py-1 min-w-[64px] min-h-[44px]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="text-[10px] font-medium">Find</span>
        </Link>
        <Link href="/create" className="flex flex-col items-center justify-center gap-0.5 text-brand-orange py-1 min-w-[64px] min-h-[44px]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[10px] font-medium">New</span>
        </Link>
        <Link href="/settings" className="flex flex-col items-center justify-center gap-0.5 text-purple-200/85 hover:text-white transition-colors py-1 min-w-[64px] min-h-[44px]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span className="text-[10px] font-medium">Settings</span>
        </Link>
        <button onClick={handleSignOut} className="flex flex-col items-center justify-center gap-0.5 text-purple-200/85 hover:text-white transition-colors py-1 min-w-[64px] min-h-[44px]">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="text-[10px] font-medium">Sign out</span>
        </button>
      </nav>
    </div>
  );
}

// ─── Session Group ────────────────────────────────────────────────────────────

function SessionGroup({ title, sessions, onCopy, copiedCode }: {
  title: string;
  sessions: MySession[];
  onCopy: (code: string) => void;
  copiedCode: string | null;
}) {
  return (
    <section>
      <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-3">{title}</h2>
      <div className="space-y-3">
        {sessions.map(s => (
          <SessionCard key={s.id} session={s} onCopy={onCopy} copiedCode={copiedCode} />
        ))}
      </div>
    </section>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">🎙</div>
      <h2 className="text-xl font-bold text-white mb-2">No sessions yet — your mic is waiting</h2>
      <p className="text-purple-200/70 text-sm mb-6">Start your first one and share the join code. The room will take it from there.</p>
      <Link href="/create" className="btn-primary py-3 px-8">Start your first session</Link>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card p-4 h-20 animate-pulse bg-brand-card/50" />
      ))}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

// ─── Discover Feed ───────────────────────────────────────────────────────────

function DiscoverFeed({ data, orgs }: { data: DiscoverResponse | null; orgs: DiscoverOrg[] | null }) {
  const [tab, setTab] = useState<'sessions' | 'channels'>('sessions');

  const loading = !data && !orgs;

  if (loading) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Discover</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4 h-24 animate-pulse bg-brand-card/50" />
          ))}
        </div>
      </section>
    );
  }

  const liveNow   = data?.live_now  ?? [];
  const featured  = data?.featured  ?? [];
  const nearby    = data?.nearby    ?? [];
  const following = data?.following ?? [];
  const channels  = orgs ?? [];

  const hasSessions = liveNow.length > 0 || featured.length > 0 || nearby.length > 0 || following.length > 0;

  return (
    <section className="space-y-4">
      {/* Section label */}
      <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Discover</h2>

      {/* Tabs + browse link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 p-1 bg-brand-card rounded-xl border border-brand-border">
          <button
            onClick={() => setTab('sessions')}
            className={`text-xs font-semibold px-3 py-1.5 min-h-[40px] rounded-lg transition-colors ${
              tab === 'sessions' ? 'bg-brand-purple text-white' : 'text-purple-200/75 hover:text-white'
            }`}
          >
            Sessions
          </button>
          <button
            onClick={() => setTab('channels')}
            className={`text-xs font-semibold px-3 py-1.5 min-h-[40px] rounded-lg transition-colors ${
              tab === 'channels' ? 'bg-brand-purple text-white' : 'text-purple-200/75 hover:text-white'
            }`}
          >
            Channels
          </button>
        </div>
        <Link href="/discover" className="text-xs text-purple-200/70 hover:text-brand-orange transition-colors inline-flex items-center min-h-[44px] px-1">
          Browse all →
        </Link>
      </div>

      {/* Sessions tab */}
      {tab === 'sessions' && (
        <div className="space-y-6">
          {!hasSessions && (
            <div className="card p-8 text-center border-dashed">
              <p className="text-purple-200/70 text-sm">No public sessions at the moment.</p>
              <p className="text-purple-200/60 text-xs mt-1">When other hosts go live, you&apos;ll see them here.</p>
            </div>
          )}
          {following.length > 0 && (
            <DiscoverSection title="From people you follow" sessions={following.slice(0, 6)} />
          )}
          {liveNow.length > 0 && (
            <DiscoverSection title="Live Now" badge={<LiveDot />} sessions={liveNow.slice(0, 4)} />
          )}
          {featured.length > 0 && (
            <DiscoverSection title="Featured" badge={<FeaturedBadge />} sessions={featured.slice(0, 4)} />
          )}
          {nearby.length > 0 && (
            <DiscoverSection title="Public Sessions" sessions={nearby.slice(0, 6)} />
          )}
        </div>
      )}

      {/* Channels tab */}
      {tab === 'channels' && (
        <div>
          {channels.length === 0 ? (
            <div className="card p-8 text-center border-dashed">
              <p className="text-purple-200/70 text-sm">No public channels yet.</p>
              <Link href="/org/new" className="text-xs text-brand-orange hover:text-brand-amber mt-2 inline-block">
                Yours could be the first →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {channels.map(org => (
                <DiscoverChannelCard key={org.id} org={org} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DiscoverSection({ title, badge, sessions }: {
  title: string;
  badge?: React.ReactNode;
  sessions: Session[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-white">{title}</span>
        {badge}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sessions.map(s => <DiscoverCard key={s.id} session={s} />)}
      </div>
    </div>
  );
}

function DiscoverCard({ session: s }: { session: Session & { distance_km?: number; participant_count?: number } }) {
  const isLive = s.status === 'live';

  return (
    <Link
      href={`/s/${s.slug}`}
      className="card p-4 flex flex-col gap-2 hover:border-brand-purple/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {s.org_name && (
            <p className="text-xs text-brand-orange/70 truncate mb-0.5">{s.org_name}</p>
          )}
          <p className="font-semibold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors line-clamp-2">
            {s.title}
          </p>
        </div>
        {isLive && (
          <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Live
          </span>
        )}
        {s.is_featured && !isLive && (
          <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-brand-amber/10 text-brand-amber text-xs font-semibold border border-brand-amber/20">
            Featured
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-purple-200/70 mt-auto">
        <span>@{s.host_username}</span>
        {s.city && <span>{s.city}</span>}
        {s.distance_km !== undefined && (
          <span>{Math.round(s.distance_km)} km</span>
        )}
        {s.starts_at && !isLive && (
          <span>{new Date(s.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        )}
        {(s.participant_count ?? 0) > 0 && (
          <span>{s.participant_count} joined</span>
        )}
      </div>
    </Link>
  );
}

function DiscoverChannelCard({ org }: { org: DiscoverOrg }) {
  return (
    <Link
      href={`/org/${org.slug}`}
      className="card p-4 flex items-center gap-3 hover:border-brand-purple/50 transition-colors group"
    >
      <ChannelAvatar
        name={org.name}
        src={org.avatar_url}
        className="w-10 h-10 rounded-xl"
        textClassName="text-sm"
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white text-sm truncate group-hover:text-brand-amber transition-colors">{org.name}</p>
        <p className="text-xs text-purple-200/70 truncate">
          {org.is_online ? 'Online' : org.city ?? ''}
          {org.member_count > 0 && ` · ${plural(org.member_count, 'member')}`}
        </p>
      </div>
      <ChevronRightIcon className="text-purple-200/50 group-hover:text-brand-orange transition-colors flex-shrink-0" />
    </Link>
  );
}

function LiveDot() {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
    </span>
  );
}

function FeaturedBadge() {
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-amber/10 text-brand-amber text-xs font-semibold border border-brand-amber/20">
      ★ Featured
    </span>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
