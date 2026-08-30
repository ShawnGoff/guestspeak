'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, resolveAsset } from '@/lib/api';
import { isLoggedIn, getUser } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';
import type { Session, DiscoverResponse, OrgSearchResult } from '@ask-away/shared/types';
import { ORG_CATEGORIES } from '@/lib/categories';
import AppNav from '@/components/AppNav';
import ChannelAvatar from '@/components/ChannelAvatar';
import RemindMe from '@/components/RemindMe';
import { plural } from '@/lib/plural';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const router = useRouter();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Join by code
  const [joinCode, setJoinCode]             = useState('');
  const [joining, setJoining]               = useState(false);
  const [joinError, setJoinError]           = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const session = await api.get<{ slug: string }>(`/sessions/code/${joinCode.trim().toUpperCase()}`);
      router.push(`/s/${session.slug}`);
    } catch {
      setJoinError('That code didn\'t match a session — double-check it and try again.');
      setJoining(false);
    }
  }

  // Unified search state
  const [nameQuery, setNameQuery]           = useState('');
  const [cityInput, setCityInput]           = useState('');
  const [citySearch, setCitySearch]         = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  /** How far ahead Upcoming reaches, and how it is ordered. */
  const [timeWindow, setTimeWindow] = useState<'all' | 'week' | 'today' | 'hour'>('all');
  const [sortBy, setSortBy]         = useState<'soon' | 'popular' | 'new'>('soon');
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);

  /**
   * Who is looking, and which upcoming sessions they have already flagged.
   *
   * One request for the page rather than a flag per card: the nearby query has
   * four variants, and joining reminders into each is four chances to get the
   * signed-out case wrong. The set is small and belongs to the viewer.
   */
  const [user, setUser] = useState<AuthUser | null>(null);
  const [reminded, setReminded] = useState<Set<string>>(new Set());

  // Channel results
  const [channels, setChannels]             = useState<OrgSearchResult[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const nameTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setMounted(true);
    fetchSessions();
    fetchChannels('', '', null, '');

    const u = getUser();
    setUser(u);
    // Guests have no account for a notification to land in, so there is
    // nothing to fetch and the button will send them to sign up.
    if (u && !u.is_guest) {
      api.get<{ sessionIds: string[] }>('/sessions/reminders')
        .then(r => setReminded(new Set(r.sessionIds)))
        // A failure here means buttons render unset. Tapping one still works
        // and the server's ON CONFLICT makes a redundant set a no-op.
        .catch(() => {});
    }
  }, []);

  function toggleReminder(id: string, on: boolean) {
    setReminded(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function fetchSessions(
    lat?: number, lng?: number, city?: string,
    win: 'all' | 'week' | 'today' | 'hour' = timeWindow,
    sort: 'soon' | 'popular' | 'new' = sortBy,
  ) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // Passed explicitly rather than read from state, because a handler that
      // sets state and refetches in the same tick would send the old value.
      if (win !== 'all')  params.set('window', win);
      if (sort !== 'soon') params.set('sort', sort);
      if (lat !== undefined && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      } else if (city) {
        params.set('city', city);
      }
      const result = await api.get<DiscoverResponse>(`/discover?${params}`);
      setData(result);
    } catch {
      setData({ live_now: [], featured: [], nearby: [], following: [] });
    } finally {
      setLoading(false);
    }
  }

  async function fetchChannels(
    q: string,
    category: string,
    gps: { lat: number; lng: number } | null,
    city: string,
  ) {
    setChannelsLoading(true);
    try {
      const params = new URLSearchParams();
      if (q)        params.set('q', q);
      if (category) params.set('category', category);
      if (gps) {
        params.set('lat', String(gps.lat));
        params.set('lng', String(gps.lng));
      } else if (city) {
        params.set('city', city);
      }
      const result = await api.get<{ orgs: OrgSearchResult[] }>(`/orgs/search?${params}`);
      setChannels(result.orgs);
    } catch {
      setChannels([]);
    } finally {
      setChannelsLoading(false);
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) return;
    setLocationStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        gpsRef.current = gps;
        setLocationStatus('granted');
        setCityInput('');
        setCitySearch('');
        fetchSessions(gps.lat, gps.lng);
        fetchChannels(nameQuery, activeCategory, gps, '');
      },
      () => setLocationStatus('denied'),
      { timeout: 8000 },
    );
  }

  function handleCitySearch(e: React.FormEvent) {
    e.preventDefault();
    gpsRef.current = null;
    setLocationStatus('idle');
    const city = cityInput.trim();
    setCitySearch(city);
    fetchSessions(undefined, undefined, city);
    fetchChannels(nameQuery, activeCategory, null, city);
  }

  function handleCityInputChange(v: string) {
    setCityInput(v);
    // If user types after GPS was granted, clear GPS mode
    if (locationStatus === 'granted') {
      gpsRef.current = null;
      setLocationStatus('idle');
    }
  }

  function handleNameChange(v: string) {
    setNameQuery(v);
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      fetchChannels(v, activeCategory, gpsRef.current, citySearch);
    }, 400);
  }

  /** Apply a category outright. The select already carries "All channels" as
      its empty option, so it has no need of the chips' tap-again-to-clear. */
  function selectCategory(cat: string) {
    setActiveCategory(cat);
    fetchChannels(nameQuery, cat, gpsRef.current, citySearch);
  }

  function handleCategoryToggle(cat: string) {
    selectCategory(activeCategory === cat ? '' : cat);
  }

  function changeWindow(win: 'all' | 'week' | 'today' | 'hour') {
    setTimeWindow(win);
    fetchSessions(gpsRef.current?.lat, gpsRef.current?.lng, citySearch, win, sortBy);
  }

  function changeSort(sort: 'soon' | 'popular' | 'new') {
    setSortBy(sort);
    fetchSessions(gpsRef.current?.lat, gpsRef.current?.lng, citySearch, timeWindow, sort);
  }

  const locationLabel =
    locationStatus === 'requesting' ? 'Locating…' :
    locationStatus === 'granted'    ? 'Using location' :
    locationStatus === 'denied'     ? 'Denied' :
    'Near me';

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav maxWidth="4xl" right={
        <div className="flex gap-1 sm:gap-2">
          {/* Sign in was shown unconditionally, so a signed-in visitor got it
              sitting next to their own account menu. Gated on `mounted` for the
              same reason as the following list below — localStorage is not
              available during the server render. It is also what pushed this
              bar to six items and 446px of content in a 375px viewport. */}
          {mounted && !isLoggedIn() && (
            <Link href="/login" className="btn-ghost text-sm py-2 px-2.5 sm:px-4">Sign in</Link>
          )}
          <Link href="/create" className="btn-primary text-sm py-2 px-3 sm:px-4 whitespace-nowrap">
            <span className="sm:hidden">Create</span>
            <span className="hidden sm:inline">Create session</span>
          </Link>
        </div>
      } />

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-white mb-1">Discover</h1>
          <p className="text-purple-200/75 text-sm">Find live sessions and channels near you.</p>
        </div>

        {/* Join by code */}
        <div className="card p-4 mb-4">
          <form onSubmit={handleJoin} className="flex gap-2">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/60 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input
                type="text"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
                placeholder="Have a join code? Enter it here…"
                maxLength={12}
                className="w-full bg-brand-bg border border-brand-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors font-mono tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={joining || !joinCode.trim()}
              className="btn-primary text-sm px-5 py-2.5 disabled:opacity-40 shrink-0"
            >
              {joining ? '…' : 'Join'}
            </button>
          </form>
          {joinError && <p className="text-red-400 text-xs mt-2 ml-1">{joinError}</p>}
        </div>

        {/* Unified search card */}
        <div className="card p-4 mb-6">
          <form onSubmit={handleCitySearch} className="flex flex-col sm:flex-row gap-2">
            {/* Channel / show name */}
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/60 pointer-events-none" />
              <input
                value={nameQuery}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Search shows &amp; channels…"
                className="w-full bg-brand-bg border border-brand-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors"
              />
            </div>

            {/* City */}
            <div className="relative flex-1">
              <LocationIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/60 pointer-events-none" />
              <input
                value={locationStatus === 'granted' ? '' : cityInput}
                onChange={e => handleCityInputChange(e.target.value)}
                placeholder={locationStatus === 'granted' ? 'Using your location' : 'City or region…'}
                className={`w-full bg-brand-bg border border-brand-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-purple transition-colors ${
                  locationStatus === 'granted'
                    ? 'text-emerald-400 placeholder-emerald-400/75'
                    : 'text-white'
                }`}
              />
            </div>

            <button type="submit" className="btn-ghost text-sm py-2.5 px-4 flex-shrink-0">
              Search
            </button>

            {/* GPS button */}
            <button
              type="button"
              onClick={requestLocation}
              disabled={locationStatus === 'requesting' || locationStatus === 'granted'}
              title="Use my location"
              className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 min-h-[44px] rounded-xl border flex-shrink-0 transition-colors ${
                locationStatus === 'granted'    ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-400 cursor-default' :
                locationStatus === 'denied'     ? 'border-red-700/50 bg-red-900/20 text-red-400 cursor-default' :
                locationStatus === 'requesting' ? 'border-brand-border text-purple-200/70 cursor-wait' :
                'border-brand-border text-brand-orange hover:border-brand-purple hover:text-brand-amber'
              }`}
            >
              <LocationIcon className="w-4 h-4" />
              <span>{locationLabel}</span>
            </button>
          </form>

          {/* Category filter.
              The filter is single-select — picking a category replaces the
              last one. On a phone the twelve chips spent five rows and most of
              the first screen saying that, which is what a select says in one
              row. Chips stay from sm up, where they wrap to two rows and are
              worth the space: they double as a list of what is on offer. */}
          <div className="mt-3 pt-3 border-t border-brand-border/40">
            <label className="sm:hidden flex items-center gap-2">
              <span className="text-xs text-purple-200/60 flex-shrink-0">Filter channels:</span>
              <select
                value={activeCategory}
                onChange={e => selectCategory(e.target.value)}
                className="input flex-1"
              >
                <option value="">All channels</option>
                {ORG_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </label>

            <div className="hidden sm:flex flex-wrap gap-2">
              <span className="text-xs text-purple-200/60 self-center mr-1">Filter channels:</span>
              {ORG_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => handleCategoryToggle(cat)}
                  className={`px-3.5 py-2 min-h-[44px] rounded-full text-xs font-semibold transition-colors ${
                    activeCategory === cat
                      ? 'bg-brand-orange text-white'
                      : 'bg-brand-bg border border-brand-border text-purple-200/75 hover:border-brand-purple'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <DiscoverSkeleton />
        ) : (
          <>
            {/* From people you follow */}
            {mounted && isLoggedIn() && (data?.following ?? []).length > 0 && (
              <Section title="From people you follow" empty="" className="mb-10">
                {(data?.following ?? []).map(s => (
                  <SessionCard key={s.id} session={s} showDistance={false} user={user} reminded={reminded.has(s.id)} onRemindToggle={toggleReminder} />
                ))}
              </Section>
            )}

            {/* Live Now */}
            <Section
              title="Live Now"
              badge={<LiveBadge />}
              empty="Nothing live at the moment — check back soon, or start your own."
            >
              {groupByChannel(data?.live_now ?? []).map(group =>
                group.sessions.length === 1
                  ? <SessionCard key={group.sessions[0].id} session={group.sessions[0]} showDistance={false} user={user} reminded={reminded.has(group.sessions[0].id)} onRemindToggle={toggleReminder} />
                  : <ChannelGroupCard key={group.key} group={group} />,
              )}
            </Section>

            {/* Nearby / Upcoming */}
            <div className="mt-10 flex flex-wrap items-center gap-2">
              {/* On the Upcoming section rather than the page, because that is
                  all they touch — Live Now is live by definition, and a "next
                  hour" control above it would imply otherwise. */}
              <div className="flex gap-1 p-1 bg-brand-card rounded-xl border border-brand-border">
                {([
                  ['hour',  'Next hour'],
                  ['today', 'Today'],
                  ['week',  'This week'],
                  ['all',   'All'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => changeWindow(key)}
                    className={`text-xs font-semibold px-3 py-1.5 min-h-[40px] rounded-lg transition-colors ${
                      timeWindow === key ? 'bg-brand-purple text-white' : 'text-purple-200/75 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-purple-200/60">Sort</span>
                <select
                  value={sortBy}
                  onChange={e => changeSort(e.target.value as 'soon' | 'popular' | 'new')}
                  className="input w-auto py-1.5"
                >
                  <option value="soon">Starting soonest</option>
                  <option value="popular">Most joined</option>
                  <option value="new">Recently added</option>
                </select>
              </label>
            </div>

            <Section
              title={citySearch ? `Near "${citySearch}"` : locationStatus === 'granted' ? 'Nearby' : 'Upcoming'}
              empty={timeWindow === 'all'
                ? 'No upcoming sessions here yet — try a different city.'
                : 'Nothing in that window. Try a wider one.'}
              className="mt-4"
            >
              {(data?.nearby ?? []).map(s => (
                <SessionCard key={s.id} session={s} showDistance user={user} reminded={reminded.has(s.id)} onRemindToggle={toggleReminder} />
              ))}
            </Section>

            {/* Channels */}
            <section className="mt-14">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-bold text-white">Channels</h2>
                <span className="text-xs text-purple-200/70">Shows, stations, podcasts &amp; more</span>
              </div>

              {channelsLoading && (
                <div className="grid sm:grid-cols-2 gap-4">
                  {[1,2,3,4].map(i => <div key={i} className="card p-5 h-24 animate-pulse bg-brand-card/50" />)}
                </div>
              )}
              {!channelsLoading && channels !== null && channels.length === 0 && (
                <p className="text-purple-200/70 text-sm text-center py-6 border border-dashed border-brand-border/30 rounded-2xl">
                  No channels matched — try a different search.
                </p>
              )}
              {!channelsLoading && channels !== null && channels.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-4">
                  {channels.map(org => <ChannelCard key={org.id} org={org} />)}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ title, badge, children, empty, className }: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode[];
  empty: string;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-bold text-white">{title}</h2>
        {badge}
      </div>
      {children.length === 0 ? (
        <p className="text-purple-200/70 text-sm py-6 text-center border border-dashed border-brand-border/30 rounded-2xl">
          {empty}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {children}
        </div>
      )}
    </section>
  );
}

// ─── Session card ─────────────────────────────────────────────────────────────

/**
 * A channel's concurrent sessions, collapsed into one row.
 *
 * A conference legitimately runs four things at once — a keynote, two tracks
 * and a workshop — and a station puts up a show plus a session per guest. Left
 * flat, one channel takes four of the twenty slots on the page and pushes
 * everyone else off it.
 *
 * Grouped rather than capped, deliberately. A cap would hide real sessions and
 * pick the survivor arbitrarily; this shows all of them behind one row that
 * says how many there are. Order within a group and between groups is
 * whatever the API returned, so the busiest still sorts first.
 *
 * A channel with one session is not a group and renders as an ordinary card —
 * a "1 session live" header would be noise on what is already a single row.
 */
interface ChannelGroup {
  key: string;
  orgName: string | null;
  orgSlug: string | null;
  orgAvatarUrl?: string | null;
  sessions: (Session & { distance_km?: number; participant_count?: number; org_avatar_url?: string })[];
}

function groupByChannel(
  sessions: (Session & { participant_count?: number; org_avatar_url?: string })[],
): ChannelGroup[] {
  const groups: ChannelGroup[] = [];
  const byOrg = new Map<string, ChannelGroup>();

  for (const s of sessions) {
    const orgSlug = (s as any).org_slug as string | undefined;
    // A session with no channel is its own group of one — personal sessions
    // have nothing to collapse under.
    if (!s.org_name || !orgSlug) {
      groups.push({ key: s.id, orgName: null, orgSlug: null, sessions: [s] });
      continue;
    }
    const existing = byOrg.get(orgSlug);
    if (existing) {
      existing.sessions.push(s);
    } else {
      const group: ChannelGroup = {
        key: orgSlug,
        orgName: s.org_name,
        orgSlug,
        orgAvatarUrl: s.org_avatar_url,
        sessions: [s],
      };
      byOrg.set(orgSlug, group);
      // Pushed on first sight, so a channel keeps the position of its
      // best-ranked session rather than jumping to the front on its second.
      groups.push(group);
    }
  }
  return groups;
}

function ChannelGroupCard({ group }: { group: ChannelGroup }) {
  const [open, setOpen] = useState(false);
  // Number(), because Postgres COUNT() is a bigint and node-postgres hands
  // bigints back as strings to avoid losing precision. Added without it, three
  // sessions of 15, 13 and 5 rendered as "01513 5" — the reduce concatenated.
  const total = group.sessions.reduce((n, s) => n + Number(s.participant_count ?? 0), 0);

  return (
    <div className="card p-5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 text-left min-h-[44px]"
      >
        <ChannelAvatar
          name={group.orgName ?? ''}
          src={group.orgAvatarUrl}
          className="w-10 h-10 rounded-xl"
          textClassName="text-sm"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white truncate">{group.orgName}</span>
          <span className="block text-xs text-purple-200/70">
            {plural(group.sessions.length, 'session')} live
            {total > 0 && ` · ${total} joined`}
          </span>
        </span>
        <span className={`text-purple-200/60 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-brand-border/40 flex flex-col gap-2">
          {group.sessions.map(s => (
            <Link
              key={s.id}
              href={`/s/${s.slug}`}
              className="flex items-center justify-between gap-3 min-h-[44px] group"
            >
              <span className="text-sm text-white truncate group-hover:text-brand-amber transition-colors">
                {s.title}
              </span>
              <span className="text-xs text-purple-200/70 shrink-0">
                {plural(Number(s.participant_count ?? 0), 'joined', 'joined')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session, showDistance, user, reminded, onRemindToggle }: {
  session: Session & { distance_km?: number; participant_count?: number; org_avatar_url?: string };
  showDistance: boolean;
  user: AuthUser | null;
  reminded: boolean;
  onRemindToggle: (id: string, on: boolean) => void;
}) {
  const isLive = session.status === 'live';
  const isLiveSoon = session.status === 'upcoming' && session.starts_at
    && (new Date(session.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  // The whole card was an anchor. A <button> inside an <a> is invalid HTML, so
  // the anchor becomes an overlay covering the card and the button sits above
  // it — the standard "stretched link", which keeps the entire card clickable
  // and gives the reminder its own hit area.
  return (
    <div className="relative card p-5 flex flex-col gap-3 hover:border-brand-purple/50 transition-colors group">
      <Link href={`/s/${session.slug}`} className="absolute inset-0 rounded-2xl" aria-label={session.title} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {session.org_name && (
            <div className="flex items-center gap-1.5 mb-1 min-w-0">
              {/* 16px: one letter, because two are unreadable at this size and
                  the channel name sits immediately beside it. The colour is
                  what carries the identity here. */}
              <ChannelAvatar
                name={session.org_name.charAt(0)}
                src={session.org_avatar_url}
                className="w-4 h-4 rounded-full"
                textClassName="text-[8px]"
              />
              <p className="text-xs text-brand-orange/70 truncate flex items-center gap-1">
                {session.org_name}
                {session.org_is_verified && (
                  <span title="Verified" className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-brand-orange text-white flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-1.5 h-1.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </p>
            </div>
          )}
          <h3 className="font-bold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors line-clamp-2">
            {session.title}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isLive ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Live
            </span>
          ) : isLiveSoon ? (
            <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
              Live Soon
            </span>
          ) : null}
          {session.is_online && (
            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold">
              Online
            </span>
          )}
        </div>
      </div>

      {session.description && (
        <p className="text-purple-200/75 text-xs leading-relaxed line-clamp-2">{session.description}</p>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-purple-200/70 mt-auto pt-1">
        <span className="truncate">{session.host_username}</span>
        <div className="flex items-center gap-3">
          {showDistance && session.distance_km !== undefined && (
            <span>{Math.round(session.distance_km)} km away</span>
          )}
          {(session.participant_count ?? 0) > 0 && (
            <span>{session.participant_count} joined</span>
          )}
          {session.city && (
            <span className="flex items-center gap-1">
              <LocationIcon className="w-3 h-3" />
              {session.city}
            </span>
          )}
          {session.starts_at && !isLive && (
            <span>{formatTime(session.starts_at)}</span>
          )}
        </div>
      </div>

      {/* Its own row rather than the meta line. Tried it there first: at 375px
          a card already carrying a host name, a count and a start time pushed
          "4 joined" and "12:11 PM" onto two lines and truncated the host to
          "tomas_lindqv…". This is the card's one action — it gets the space. */}
      {session.status === 'upcoming' && (
        <div className="flex justify-end">
          <RemindMe
            sessionId={session.id}
            user={user}
            initialReminded={reminded}
            onChange={on => onRemindToggle(session.id, on)}
            className="relative z-10"
          />
        </div>
      )}
    </div>
  );
}

// ─── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({ org }: { org: OrgSearchResult }) {
  return (
    <Link href={`/org/${org.slug}`} className="card p-5 flex gap-4 hover:border-brand-purple/50 transition-colors group">
      <ChannelAvatar
        name={org.name}
        src={org.avatar_url}
        className="w-12 h-12 rounded-full"
        textClassName="text-base"
      />

      <div className="min-w-0 flex-1">
        <h3 className="font-bold text-white text-sm group-hover:text-brand-amber transition-colors truncate">
          {org.name}
        </h3>

        {org.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {org.categories.slice(0, 3).map(cat => (
              <span key={cat} className="text-xs px-2 py-0.5 rounded-full bg-brand-purple/20 text-purple-300">
                {cat}
              </span>
            ))}
          </div>
        )}

        {org.description && (
          <p className="text-purple-200/70 text-xs mt-1.5 line-clamp-1">{org.description}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-purple-200/60">
          {org.city && (
            <span className="flex items-center gap-1">
              <LocationIcon className="w-3 h-3" />
              {org.city}
            </span>
          )}
          {org.distance_km !== undefined && (
            <span>{Math.round(org.distance_km)} km away</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DiscoverSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card p-5 h-28 animate-pulse bg-brand-card/50" />
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
      Live
    </span>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function LocationIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
