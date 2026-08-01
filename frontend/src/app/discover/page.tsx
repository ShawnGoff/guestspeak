'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { api, resolveAsset } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import type { Session, DiscoverResponse, OrgSearchResult } from '@ask-away/shared/types';
import { ORG_CATEGORIES } from '@/lib/categories';
import AppNav from '@/components/AppNav';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Unified search state
  const [nameQuery, setNameQuery]           = useState('');
  const [cityInput, setCityInput]           = useState('');
  const [citySearch, setCitySearch]         = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null);

  // Channel results
  const [channels, setChannels]             = useState<OrgSearchResult[] | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const nameTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setMounted(true);
    fetchSessions();
    fetchChannels('', '', null, '');
  }, []);

  async function fetchSessions(lat?: number, lng?: number, city?: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (lat !== undefined && lng !== undefined) {
        params.set('lat', String(lat));
        params.set('lng', String(lng));
      } else if (city) {
        params.set('city', city);
      }
      const result = await api.get<DiscoverResponse>(`/discover?${params}`);
      setData(result);
    } catch {
      setData({ live_now: [], nearby: [], following: [] });
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

  function handleCategoryToggle(cat: string) {
    const next = activeCategory === cat ? '' : cat;
    setActiveCategory(next);
    fetchChannels(nameQuery, next, gpsRef.current, citySearch);
  }

  const locationLabel =
    locationStatus === 'requesting' ? 'Locating…' :
    locationStatus === 'granted'    ? 'Using location' :
    locationStatus === 'denied'     ? 'Denied' :
    'Near me';

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav maxWidth="4xl" right={
        <div className="flex gap-2">
          <Link href="/login" className="btn-ghost text-sm py-2 px-4">Sign in</Link>
          <Link href="/create" className="btn-primary text-sm py-2 px-4">Create session</Link>
        </div>
      } />

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-extrabold text-white mb-1">Discover</h1>
          <p className="text-purple-200/50 text-sm">Find live Q&amp;As and channels near you.</p>
        </div>

        {/* Unified search card */}
        <div className="card p-4 mb-6">
          <form onSubmit={handleCitySearch} className="flex flex-col sm:flex-row gap-2">
            {/* Channel / show name */}
            <div className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/30 pointer-events-none" />
              <input
                value={nameQuery}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="Search shows &amp; channels…"
                className="w-full bg-brand-bg border border-brand-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-purple-200/30 focus:outline-none focus:border-brand-purple transition-colors"
              />
            </div>

            {/* City */}
            <div className="relative flex-1">
              <LocationIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-200/30 pointer-events-none" />
              <input
                value={locationStatus === 'granted' ? '' : cityInput}
                onChange={e => handleCityInputChange(e.target.value)}
                placeholder={locationStatus === 'granted' ? 'Using your location' : 'City or region…'}
                className={`w-full bg-brand-bg border border-brand-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-brand-purple transition-colors ${
                  locationStatus === 'granted'
                    ? 'text-emerald-400 placeholder-emerald-400/60'
                    : 'text-white placeholder-purple-200/30'
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
              className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-xl border flex-shrink-0 transition-colors ${
                locationStatus === 'granted'    ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-400 cursor-default' :
                locationStatus === 'denied'     ? 'border-red-700/50 bg-red-900/20 text-red-400 cursor-default' :
                locationStatus === 'requesting' ? 'border-brand-border text-purple-200/40 cursor-wait' :
                'border-brand-border text-brand-orange hover:border-brand-purple hover:text-brand-amber'
              }`}
            >
              <LocationIcon className="w-4 h-4" />
              <span className="hidden sm:inline">{locationLabel}</span>
            </button>
          </form>

          {/* Category chips — filter channels */}
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-brand-border/40">
            <span className="text-xs text-purple-200/30 self-center mr-1">Filter channels:</span>
            {ORG_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => handleCategoryToggle(cat)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  activeCategory === cat
                    ? 'bg-brand-orange text-white'
                    : 'bg-brand-bg border border-brand-border text-purple-200/50 hover:border-brand-purple'
                }`}
              >
                {cat}
              </button>
            ))}
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
                  <SessionCard key={s.id} session={s} showDistance={false} />
                ))}
              </Section>
            )}

            {/* Live Now */}
            <Section
              title="Live Now"
              badge={<LiveBadge />}
              empty="No sessions live right now. Check back soon."
            >
              {(data?.live_now ?? []).map(s => (
                <SessionCard key={s.id} session={s} showDistance={false} />
              ))}
            </Section>

            {/* Nearby / Upcoming */}
            <Section
              title={citySearch ? `Near "${citySearch}"` : locationStatus === 'granted' ? 'Nearby' : 'Upcoming'}
              empty="No upcoming sessions found. Try a different city."
              className="mt-10"
            >
              {(data?.nearby ?? []).map(s => (
                <SessionCard key={s.id} session={s} showDistance />
              ))}
            </Section>

            {/* Channels */}
            <section className="mt-14">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-lg font-bold text-white">Channels</h2>
                <span className="text-xs text-purple-200/40">Shows, stations, podcasts &amp; more</span>
              </div>

              {channelsLoading && (
                <div className="grid sm:grid-cols-2 gap-4">
                  {[1,2,3,4].map(i => <div key={i} className="card p-5 h-24 animate-pulse bg-brand-card/50" />)}
                </div>
              )}
              {!channelsLoading && channels !== null && channels.length === 0 && (
                <p className="text-purple-200/40 text-sm text-center py-6 border border-dashed border-brand-border/30 rounded-2xl">
                  No channels found. Try a different search.
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
        <p className="text-purple-200/40 text-sm py-6 text-center border border-dashed border-brand-border/30 rounded-2xl">
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

function SessionCard({ session, showDistance }: { session: Session & { distance_km?: number; participant_count?: number; org_avatar_url?: string }; showDistance: boolean }) {
  const isLive = session.status === 'live';
  const isLiveSoon = session.status === 'upcoming' && session.starts_at
    && (new Date(session.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  return (
    <Link href={`/s/${session.slug}`} className="card p-5 flex flex-col gap-3 hover:border-brand-purple/50 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {session.org_name && (
            <div className="flex items-center gap-1.5 mb-1 min-w-0">
              {session.org_avatar_url ? (
                <img
                  src={resolveAsset(session.org_avatar_url)}
                  alt={session.org_name}
                  className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-4 h-4 rounded-full bg-brand-purple/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-[8px] font-bold text-purple-300">
                    {session.org_name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
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
        <p className="text-purple-200/50 text-xs leading-relaxed line-clamp-2">{session.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-purple-200/40 mt-auto pt-1">
        <span>{session.host_username}</span>
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
    </Link>
  );
}

// ─── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({ org }: { org: OrgSearchResult }) {
  return (
    <Link href={`/org/${org.slug}`} className="card p-5 flex gap-4 hover:border-brand-purple/50 transition-colors group">
      <div className="flex-shrink-0 w-12 h-12 rounded-full bg-brand-bg border border-brand-border overflow-hidden flex items-center justify-center">
        {org.avatar_url ? (
          <img src={resolveAsset(org.avatar_url)} alt={org.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-lg font-bold text-purple-200/30">
            {org.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

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
          <p className="text-purple-200/40 text-xs mt-1.5 line-clamp-1">{org.description}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-xs text-purple-200/30">
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
