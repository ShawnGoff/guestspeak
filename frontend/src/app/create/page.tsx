'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getUser, isLoggedIn, isGuest } from '@/lib/auth';
import AppNav from '@/components/AppNav';
import LocationAutocomplete, { type LocationResult } from '@/components/LocationAutocomplete';
import QRCode from 'react-qr-code';

interface Org { id: string; name: string; slug: string; }

export default function CreateSessionPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [orgs, setOrgs]       = useState<Org[]>([]);

  // Form fields
  const [title, setTitle]               = useState('');
  const [description, setDescription]   = useState('');
  const [visibility, setVisibility]     = useState<'public' | 'unlisted' | 'private'>('public');
  const [orgId, setOrgId]               = useState('');
  const [credits, setCredits]           = useState(3);
  const [city, setCity]                 = useState('');
  const [region, setRegion]             = useState('');
  const [country, setCountry]           = useState('');
  const [lat, setLat]                   = useState<number | undefined>();
  const [lng, setLng]                   = useState<number | undefined>();
  const [startDate, setStartDate]       = useState('');
  const [startTime, setStartTime]       = useState('');
  const [isOnline, setIsOnline]           = useState(false);
  const [cutoffEnabled, setCutoffEnabled] = useState(false);
  const [cutoffMins, setCutoffMins]     = useState(15);

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState<{ code: string; slug: string; title: string } | null>(null);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) { router.push('/login?next=/create'); return; }
    // Load orgs the user belongs to as owner/admin
    api.get<{ orgs: Org[] }>('/orgs/mine').then(r => setOrgs(r.orgs)).catch(() => {});
  }, []);

  if (!mounted) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Title is required'); return; }
    if (!startDate || !startTime) { setError('Date and time are required'); return; }
    setLoading(true);

    try {
      // Calculate submission cutoff
      const startsAt = startDate && startTime ? `${startDate}T${startTime}:00` : undefined;

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
        starts_at: startsAt,
        submission_cutoff_at,
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

    function copyCode() { navigator.clipboard.writeText(joinCode!.code); }
    function copyLink() { navigator.clipboard.writeText(joinUrl); }

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
            <p className="text-purple-200/50 text-sm">Your audience can join right now.</p>
          </div>

          {/* QR + code card */}
          <div className="card p-6 sm:p-8 mb-4">
            {/* QR code */}
            <div className="bg-white rounded-2xl p-4 inline-block mb-6">
              <QRCode value={joinUrl} size={168} />
            </div>

            {/* Big join code */}
            <p className="text-xs text-purple-200/40 uppercase tracking-widest mb-2">Join code</p>
            <button
              onClick={copyCode}
              className="text-5xl font-extrabold text-orange-gradient tracking-[0.15em] mb-1 hover:opacity-80 transition-opacity cursor-copy"
              title="Tap to copy code"
            >
              {joinCode.code}
            </button>
            <p className="text-xs text-purple-200/30 mb-6">Tap code to copy</p>

            {/* Actions */}
            <div className="flex flex-col gap-2.5">
              <button onClick={copyLink} className="btn-ghost py-2.5 text-sm flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
                Copy link
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
          <p className="text-xs text-purple-200/30 leading-relaxed">
            Audience scans the QR or goes to <span className="text-white/50">guestspeak.app</span> and types the code — no app or account needed.
          </p>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/50 hover:text-white transition-colors">Dashboard</Link>} />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-extrabold text-white mb-1">Create a session</h1>
        <p className="text-purple-200/50 text-sm mb-8">Fill in the details below.</p>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Basics */}
          <Section title="Basics">
            <FormField label="Session title *">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Morning Drive Q&A with KGMZ"
                maxLength={255}
                className="input"
              />
            </FormField>

            <FormField label="Description">
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What's this session about?"
                rows={3}
                maxLength={1000}
                className="input resize-none"
              />
            </FormField>

            {/* Org selector — only shown if user has orgs */}
            {orgs.length > 0 && (
              <FormField label="Post under channel" hint="Sessions under a channel inherit channel moderators automatically">
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
                    <p className="text-purple-200/50 text-xs mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </Section>

          {/* Credits */}
          <Section title="Credits per person">
            <FormField
              label={`${credits} credit${credits !== 1 ? 's' : ''} — each question or Echo costs 1`}
            >
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={5}
                  value={credits}
                  onChange={e => setCredits(Number(e.target.value))}
                  className="flex-1 accent-brand-orange"
                />
                <div className="flex gap-1.5">
                  {Array.from({ length: 5 }).map((_, i) => (
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
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Date">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="input"
                  required
                />
              </FormField>
              <FormField label="Time">
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="input"
                  required
                />
              </FormField>
            </div>

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
                <FormField label="Location (optional)" hint="Helps people find you in Nearby">
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
                  <span className="text-sm text-white">Close questions before event starts</span>
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
      {hint && <p className="text-xs text-purple-200/40 mt-1.5">{hint}</p>}
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
    desc: 'Link and join code only. Perfect for fan clubs, private shows, or invite-only events.',
  },
  {
    value: 'private',
    label: 'Private',
    desc: 'Invite-only. Coming soon.',
  },
];
