'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser, isLoggedIn, isGuest } from '@/lib/auth';
import AppNav from '@/components/AppNav';
import LocationAutocomplete, { type LocationResult } from '@/components/LocationAutocomplete';
import QRCode from 'react-qr-code';

interface Org { id: string; name: string; slug: string; }

function CreateSessionPageInner() {
  const router = useRouter();
  // ?org= arrives from the Create session button on a channel page, so someone
  // who started on their channel does not land here and have to pick it again
  // out of a list they were just looking at.
  const preselectedOrg = useSearchParams().get('org') ?? '';
  const [mounted, setMounted] = useState(false);
  const [orgs, setOrgs]       = useState<Org[]>([]);

  // Form fields
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [visibility, setVisibility]     = useState<'public' | 'unlisted' | 'private'>('public');
  const [orgId, setOrgId]               = useState(preselectedOrg);
  const [credits, setCredits]           = useState(6);
  const [city, setCity]                 = useState('');
  const [region, setRegion]             = useState('');
  const [country, setCountry]           = useState('');
  const [lat, setLat]                   = useState<number | undefined>();
  const [lng, setLng]                   = useState<number | undefined>();
  const [startNow, setStartNow]         = useState(false);
  const [startDate, setStartDate]       = useState('');
  const [startTime, setStartTime]       = useState('');
  const [isOnline, setIsOnline]           = useState(false);
  const [streamUrl, setStreamUrl]         = useState('');
  const [cutoffEnabled, setCutoffEnabled] = useState(false);
  const [cutoffMins, setCutoffMins]     = useState(15);
  const [requiresApproval, setRequiresApproval] = useState(false);

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<{ code: string; slug: string; title: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) { router.push('/login?next=/create'); return; }
    // Load orgs the user belongs to as owner/admin
    api.get<{ orgs: Org[] }>('/orgs/mine').then(r => {
      setOrgs(r.orgs);
      // Drop a preselection the caller does not actually manage. The id comes
      // from a URL, so it can be anything; the server would reject it on
      // submit, but only after the whole form had been filled in.
      if (preselectedOrg && !r.orgs.some(o => o.id === preselectedOrg)) setOrgId('');
    }).catch(() => {});
  }, [router]);

  if (!mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Your session needs a title.'); return; }
    if (!startNow && (!startDate || !startTime)) { setError('Pick a date and time, or toggle "Go live now".'); return; }
    setLoading(true);

    try {
      // Calculate submission cutoff
      const startsAt = startNow ? new Date().toISOString() : (startDate && startTime ? `${startDate}T${startTime}:00` : undefined);

      let submission_cutoff_at: string | undefined;
      if (cutoffEnabled && startsAt) {
        const t = new Date(startsAt);
        t.setMinutes(t.getMinutes() - cutoffMins);
        submission_cutoff_at = t.toISOString();
      }

      const session = await api.post<any>('/sessions', {
        title: title.trim(),
        description: description.trim() || undefined,
        visibility,
        credits_per_user: credits,
        org_id: orgId || undefined,
        city:    isOnline ? undefined : city.trim() || undefined,
        region:  isOnline ? undefined : region.trim() || undefined,
        country: isOnline ? undefined : country.trim() || undefined,
        lat:     isOnline ? undefined : lat,
        lng:     isOnline ? undefined : lng,
        is_online: isOnline,
        stream_url: streamUrl.trim() || undefined,
        starts_at: startsAt,
        submission_cutoff_at,
        requires_approval: requiresApproval || undefined,
      });

      setJoinCode({ code: session.join_code, slug: session.slug, title: session.title });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Session created screen ────────────────────────────────────────────────
  if (joinCode) {
    const origin  = typeof window !== 'undefined' ? window.location.origin : 'https://guestspeak.app';
    const joinUrl = `${origin}/s/${joinCode.slug}`;

    function copyCode() {
      navigator.clipboard.writeText(joinCode!.code).then(() => {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      });
    }
    function copyLink() {
      navigator.clipboard.writeText(joinUrl).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      });
    }

    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4 py-12">
        {/* Success glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full bg-brand-orange/5 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md text-center">

          {/* Heading */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Session created
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight mb-2">
              {joinCode.title}
            </h1>
            <p className="text-purple-200/75 text-sm">The room is open — your audience can join right now.</p>
          </div>

          {/* QR + code card */}
          <div className="card p-6 sm:p-8 mb-4">
            {/* QR code */}
            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              <QRCode value={joinUrl} size={168} />
            </div>

            {/* Big join code */}
            <p className="text-xs text-purple-200/70 uppercase tracking-widest mb-2">Join code</p>
            <button
              onClick={copyCode}
              className="text-5xl font-extrabold text-orange-gradient tracking-[0.15em] mb-1 hover:opacity-80 transition-opacity cursor-copy"
              title="Tap to copy code"
            >
              {joinCode.code}
            </button>
            <p className={`text-xs mb-6 transition-colors ${copiedCode ? 'text-emerald-400' : 'text-purple-200/60'}`}>
              {copiedCode ? 'Code copied!' : 'Tap code to copy'}
            </p>

            {/* Actions */}
            <div className="flex flex-col gap-2.5">
              <button onClick={copyLink} className="btn-ghost py-2.5 text-sm flex items-center justify-center gap-2">
                {copiedLink ? (
                  <>
                    <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                    </svg>
                    Copy link
                  </>
                )}
              </button>
              <button
                onClick={() => router.push(`/s/${joinCode.slug}`)}
                className="btn-primary py-3 text-sm font-semibold"
              >
                Open session →
              </button>
            </div>
          </div>

          {/* Helper note */}
          <p className="text-xs text-purple-200/60 leading-relaxed">
            Attendees scan the QR or go to <span className="text-white/80">guestspeak.app</span> and enter the code — no app, no account, no waiting.
          </p>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors inline-flex items-center min-h-[44px]">Dashboard</Link>} />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-extrabold text-white mb-1">Create a session</h1>
        <p className="text-purple-200/75 text-sm mb-8">Give it a title and a start time — everything else is optional.</p>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Basics */}
          <Section title="Basics">
            <FormField label="Session title *">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Morning Drive Q&A with The Press Box"
                maxLength={255}
                className="input"
              />
            </FormField>

            <FormField label="Description">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What should the room know before they ask?"
                rows={3}
                maxLength={1000}
                className="input resize-none"
              />
            </FormField>

            {/* Org selector — only shown if user has orgs */}
            {orgs.length > 0 && (
              <FormField label="Post under channel" hint="Channel sessions automatically share the channel's moderators — no need to re-invite anyone">
                <select value={orgId} onChange={e => setOrgId(e.target.value)} className="input">
                  <option value="">My personal account</option>
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </FormField>
            )}
          </Section>

          {/* Visibility */}
          <Section title="Visibility">
            <div className="space-y-2">
              {VISIBILITY_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    visibility === opt.value
                      ? 'border-brand-purple bg-brand-purple/10'
                      : 'border-brand-border hover:border-brand-border/80'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={visibility === opt.value}
                    onChange={() => setVisibility(opt.value as any)}
                    className="mt-0.5 accent-brand-orange"
                  />
                  <div>
                    <p className="text-white text-sm font-semibold">{opt.label}</p>
                    <p className="text-purple-200/75 text-xs mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </Section>

          {/* Credits */}
          <Section title="Credits per person">
            <FormField
              label={`${credits} credit${credits !== 1 ? 's' : ''} — each question or Echo costs 1`}
              hint="How many credits each attendee holds at once (1–6). Everyone earns +1 every 10 minutes back up to that number — guests stop after 2 refills; signed-in users keep earning all session."
            >
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={credits}
                  onChange={e => setCredits(Number(e.target.value))}
                  className="flex-1 accent-brand-orange h-11 cursor-pointer"
                />
                <div className="flex gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        i < credits ? 'bg-brand-orange' : 'bg-brand-border'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </FormField>
          </Section>

          {/* Timing + Location */}
          <Section title="Timing & location">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setStartNow(v => !v)}
                className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${startNow ? 'bg-brand-orange' : 'bg-brand-purple/40'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${startNow ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm text-white">Go live now</span>
            </label>

            {!startNow && (
              <div className="grid sm:grid-cols-2 gap-4">
                <FormField label="Date">
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="input"
                  />
                </FormField>
                <FormField label="Time">
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    className="input"
                  />
                </FormField>
              </div>
            )}

            <div className="mt-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  onClick={() => setIsOnline(v => !v)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                    isOnline ? 'bg-brand-orange' : 'bg-brand-purple/40'
                  }`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    isOnline ? 'translate-x-5' : 'translate-x-1'
                  }`} />
                </div>
                <span className="text-sm text-white">Online / Virtual only</span>
              </label>
            </div>

            {!isOnline && (
              <div className="mt-4">
                <FormField label="Location (optional)" hint="Helps people nearby discover your session">
                  <LocationAutocomplete
                    value={city}
                    onChange={setCity}
                    onSelect={(r: LocationResult) => {
                      setCity(r.city);
                      setRegion(r.region);
                      setCountry(r.country);
                      setLat(r.lat);
                      setLng(r.lng);
                    }}
                  />
                </FormField>
              </div>
            )}

            <div className="mt-4">
              <FormField
                label="Live stream URL (optional)"
                hint="YouTube or Twitch — your audience can watch and ask questions on the same page"
              >
                <input
                  type="url"
                  value={streamUrl}
                  onChange={e => setStreamUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=… or https://twitch.tv/…"
                  className="input"
                />
              </FormField>
            </div>

            <div className="mt-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div
                    onClick={() => setCutoffEnabled(v => !v)}
                    className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${
                      cutoffEnabled ? 'bg-brand-orange' : 'bg-brand-purple/40'
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      cutoffEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`} />
                  </div>
                  <span className="text-sm text-white">Close questions before the session starts</span>
                </label>

                {cutoffEnabled && (
                  <div className="mt-3 ml-13 flex items-center gap-3">
                    <select
                      value={cutoffMins}
                      onChange={e => setCutoffMins(Number(e.target.value))}
                      className="input w-auto"
                    >
                      <option value={5}>5 minutes before</option>
                      <option value={10}>10 minutes before</option>
                      <option value={15}>15 minutes before</option>
                      <option value={30}>30 minutes before</option>
                      <option value={60}>1 hour before</option>
                    </select>
                  </div>
                )}
              </div>

            <div className="mt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setRequiresApproval(v => !v)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${requiresApproval ? 'bg-brand-orange' : 'bg-brand-purple/40'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${requiresApproval ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
                <div>
                  <span className="text-sm text-white">Require approval for questions</span>
                  <p className="text-xs text-purple-200/70 mt-0.5">New questions stay hidden until you approve them — you decide what the room sees</p>
                </div>
              </label>
            </div>
          </Section>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="btn-primary px-8 py-3">
              {loading ? 'Creating…' : 'Create session'}
            </button>
            <Link href="/dashboard" className="btn-ghost px-6 py-3">Cancel</Link>
          </div>
        </form>
      </main>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">{title}</h2>
      {children}
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-purple-200/70 mt-1.5">{hint}</p>}
    </div>
  );
}

const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    desc: 'Shows up in Live Now and Nearby. Anyone can join.',
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    desc: 'Only people with the link or join code can find it. Perfect for fan clubs, private shows, and invite-only rooms.',
  },
  {
    value: 'private',
    label: 'Private',
    desc: 'Invite-only. Attendees must be signed in and approved by you before they can join.',
  },
];

// useSearchParams forces this route out of static rendering, and without a
// Suspense boundary `next build` fails on it — a break that tsc cannot see and
// that only shows up at deploy time. Same wrapper as /search, /reset-password
// and /demo/session.
export default function CreateSessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-bg" />}>
      <CreateSessionPageInner />
    </Suspense>
  );
}
