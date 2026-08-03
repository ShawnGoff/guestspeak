'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest } from '@/lib/auth';
import LocationAutocomplete, { type LocationResult } from '@/components/LocationAutocomplete';
import AppNav from '@/components/AppNav';

interface Org { id: string; name: string; slug: string; }

export default function EditSessionPage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // Form fields
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility]   = useState<'public' | 'unlisted' | 'private'>('public');
  const [credits, setCredits]         = useState(3);
  const [city, setCity]               = useState('');
  const [region, setRegion]           = useState('');
  const [country, setCountry]         = useState('');
  const [lat, setLat]                 = useState<number | undefined>();
  const [lng, setLng]                 = useState<number | undefined>();
  const [startDate, setStartDate]     = useState('');
  const [startTime, setStartTime]     = useState('');
  const [isOnline, setIsOnline]           = useState(false);
  const [streamUrl, setStreamUrl]         = useState('');
  const [cutoffEnabled, setCutoffEnabled] = useState(false);
  const [cutoffMins, setCutoffMins]   = useState(15);
  const [requiresApproval, setRequiresApproval] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) {
      router.push(`/login?next=/s/${params.slug}/edit`);
      return;
    }

    Promise.all([
      api.get<any>(`/sessions/${params.slug}`),
      api.get<{ orgs: Org[] }>('/orgs/mine'),
    ])
      .then(([session, orgData]) => {
        if (!['host', 'org_owner', 'org_admin'].includes(session.caller_role)) {
          setForbidden(true);
          return;
        }

        setSessionId(session.id);
        setTitle(session.title ?? '');
        setDescription(session.description ?? '');
        setVisibility(session.visibility ?? 'public');
        setCredits(session.credits_per_user ?? 3);
        setCity(session.city ?? '');
        setRegion(session.region ?? '');
        setCountry(session.country ?? '');
        if (session.lat)  setLat(session.lat);
        if (session.lng)  setLng(session.lng);
        setIsOnline(session.is_online ?? false);
        setStreamUrl(session.stream_url ?? '');

        if (session.starts_at) {
          const d = new Date(session.starts_at);
          setStartDate(d.toISOString().slice(0, 10));
          setStartTime(d.toISOString().slice(11, 16));
        }

        if (session.submission_cutoff_at && session.starts_at) {
          setCutoffEnabled(true);
          const startsAt = new Date(session.starts_at).getTime();
          const cutoff = new Date(session.submission_cutoff_at).getTime();
          const diffMins = Math.round((startsAt - cutoff) / 60000);
          setCutoffMins([5, 10, 15, 30, 60].includes(diffMins) ? diffMins : 15);
        }

        setRequiresApproval(session.requires_approval ?? false);
        setOrgs(orgData.orgs);
      })
      .catch(err => {
        if (err.status === 404) setNotFound(true);
      })
      .finally(() => setPageLoading(false));
  }, [params.slug]);

  if (!mounted || pageLoading) return null;

  if (notFound) return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <p className="text-white">Session not found.</p>
    </div>
  );

  if (forbidden) return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center gap-4 flex-col">
      <p className="text-white font-bold">You don't have permission to edit this session.</p>
      <Link href={`/s/${params.slug}`} className="text-brand-orange text-sm">Back to session →</Link>
    </div>
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError('Title is required'); return; }
    setLoading(true);

    try {
      const startsAt = startDate && startTime ? `${startDate}T${startTime}:00` : undefined;

      let submission_cutoff_at: string | undefined | null = null;
      if (cutoffEnabled && startsAt) {
        const t = new Date(startsAt);
        t.setMinutes(t.getMinutes() - cutoffMins);
        submission_cutoff_at = t.toISOString();
      }

      await api.patch(`/sessions/${sessionId}`, {
        title: title.trim(),
        description: description.trim() || undefined,
        visibility,
        credits_per_user: credits,
        city:    isOnline ? undefined : city.trim() || undefined,
        region:  isOnline ? undefined : region.trim() || undefined,
        country: isOnline ? undefined : country.trim() || undefined,
        lat:     isOnline ? undefined : lat,
        lng:     isOnline ? undefined : lng,
        is_online: isOnline,
        stream_url: streamUrl.trim() || '',
        starts_at: startsAt,
        submission_cutoff_at,
        requires_approval: requiresApproval,
      });

      setSaved(true);
      setTimeout(() => router.push(`/s/${params.slug}`), 1000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={
        <Link href={`/s/${params.slug}`} className="text-sm text-purple-200/50 hover:text-white transition-colors">
          ← Back to session
        </Link>
      } />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-extrabold text-white mb-1">Edit session</h1>
        <p className="text-purple-200/50 text-sm mb-8">Changes take effect immediately.</p>

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
            <FormField label={`${credits} credit${credits !== 1 ? 's' : ''} — each question or Echo costs 1`}>
              <div className="flex items-center gap-4">
                <input
                  type="range" min={1} max={6} value={credits}
                  onChange={e => setCredits(Number(e.target.value))}
                  className="flex-1 accent-brand-orange"
                />
                <div className="flex gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-3 h-3 rounded-full transition-colors ${i < credits ? 'bg-brand-orange' : 'bg-brand-border'}`} />
                  ))}
                </div>
              </div>
            </FormField>
          </Section>

          {/* Timing + Location */}
          <Section title="Timing & location">
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Date">
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input" />
              </FormField>
              <FormField label="Time">
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="input" />
              </FormField>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setIsOnline(v => !v)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${isOnline ? 'bg-brand-orange' : 'bg-brand-purple/40'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isOnline ? 'translate-x-5' : 'translate-x-1'}`} />
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
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setCutoffEnabled(v => !v)}
                  className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${cutoffEnabled ? 'bg-brand-orange' : 'bg-brand-purple/40'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${cutoffEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm text-white">Close questions before event starts</span>
              </label>

              {cutoffEnabled && (
                <div className="mt-3">
                  <select value={cutoffMins} onChange={e => setCutoffMins(Number(e.target.value))} className="input w-auto">
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
                  <p className="text-xs text-purple-200/40 mt-0.5">Questions are hidden until you approve them</p>
                </div>
              </label>
            </div>
          </Section>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {saved && (
            <div className="bg-emerald-900/30 border border-emerald-700/50 text-emerald-400 text-sm rounded-xl px-4 py-3">
              Saved! Redirecting…
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading || saved} className="btn-primary px-8 py-3 disabled:opacity-40">
              {loading ? 'Saving…' : 'Save changes'}
            </button>
            <Link href={`/s/${params.slug}`} className="btn-ghost px-6 py-3">Cancel</Link>
          </div>
        </form>
      </main>

    </div>
  );
}

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
  { value: 'public',   label: 'Public',   desc: 'Shows up in Live Now and Nearby. Anyone can join.' },
  { value: 'unlisted', label: 'Unlisted', desc: 'Link and join code only. Perfect for invite-only events.' },
  { value: 'private',  label: 'Private',  desc: 'Invite-only. Coming soon.' },
];
