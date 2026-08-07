'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest } from '@/lib/auth';
import LocationAutocomplete, { type LocationResult } from '@/components/LocationAutocomplete';
import { ORG_CATEGORIES } from '@/lib/categories';
import AppNav from '@/components/AppNav';

const INPUT_CLASS = "input";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function NewOrgPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite]         = useState('');
  const [avatarFile, setAvatarFile]   = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [city, setCity]               = useState('');
  const [region, setRegion]           = useState('');
  const [country, setCountry]         = useState('');
  const [lat, setLat]                 = useState<number | undefined>();
  const [lng, setLng]                 = useState<number | undefined>();
  const [categories, setCategories]   = useState<string[]>([]);
  const [isOnline, setIsOnline]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) router.push('/login?next=/org/new');
  }, [router]);

  if (!mounted) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5 MB'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Your channel needs a name.'); return; }
    setLoading(true);

    try {
      let avatar_url: string | undefined;

      if (avatarFile) {
        const token = localStorage.getItem('aa_token');
        const form = new FormData();
        form.append('file', avatarFile);
        const res = await fetch(`${API_BASE}/api/upload`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        if (!res.ok) throw new Error('Image upload failed');
        const data = await res.json();
        avatar_url = data.url; // relative path — resolved at display time using API_BASE
      }

      const org = await api.post<{ slug: string }>('/orgs', {
        name: name.trim(),
        description: description.trim() || undefined,
        website: website.trim()
          ? website.trim().match(/^https?:\/\//) ? website.trim() : `https://${website.trim()}`
          : undefined,
        avatar_url,
        city:      isOnline ? undefined : city.trim()    || undefined,
        region:    isOnline ? undefined : region.trim()  || undefined,
        country:   isOnline ? undefined : country.trim() || undefined,
        lat:       isOnline ? undefined : lat,
        lng:       isOnline ? undefined : lng,
        is_online: isOnline,
        categories,
      });

      router.push(`/org/${org.slug}/settings`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>} />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-extrabold text-white mb-1">Create a channel</h1>
        <p className="text-purple-200/75 text-sm mb-8">
          Running more than one session? A channel keeps them all together — and makes you easier to find.
        </p>

        <form onSubmit={handleSubmit} className="card p-6 space-y-5">

          {/* Avatar upload */}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-full bg-brand-bg border-2 border-dashed border-brand-border hover:border-brand-purple transition-colors flex-shrink-0 overflow-hidden group"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Channel photo" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-1">
                  <svg className="w-6 h-6 text-purple-200/60 group-hover:text-brand-purple transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
              )}
              {avatarPreview && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6-6 3.536 3.536-6 6H9v-3.536z" />
                  </svg>
                </div>
              )}
            </button>

            <div>
              <p className="text-sm font-semibold text-white mb-0.5">Channel photo</p>
              <p className="text-xs text-purple-200/70">JPEG, PNG, or WebP · max 5 MB</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2 text-xs text-brand-orange hover:text-brand-amber transition-colors"
              >
                {avatarPreview ? 'Change photo' : 'Upload photo'}
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <OrgField label="Channel name *" hint="Your podcast, show, station, organization, or brand name.">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. The Midnight Hour, Westside Records, KGMZ 99.1"
              maxLength={255}
              className={INPUT_CLASS}
            />
          </OrgField>

          <OrgField label="Description" hint="What kind of sessions do you run?">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Tell people what your sessions are about…"
              rows={3}
              maxLength={1000}
              className={`${INPUT_CLASS} resize-none`}
            />
          </OrgField>

          <OrgField label="Website" hint="Optional — shown on your public channel page.">
            <input
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="yourshow.com"
              type="text"
              className={INPUT_CLASS}
            />
          </OrgField>

          <div>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
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
              <span className="text-sm text-white font-semibold">Online / Virtual only</span>
            </label>
            {!isOnline && (
              <OrgField label="Location" hint="Helps people nearby discover your channel and sessions.">
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
              </OrgField>
            )}
          </div>

          <OrgField label="Categories" hint="Pick all that apply, so the right audience can find you.">
            <div className="grid grid-cols-3 gap-2 mt-1">
              {ORG_CATEGORIES.map(cat => {
                const checked = categories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors text-sm ${
                      checked
                        ? 'border-brand-purple bg-brand-purple/10 text-white'
                        : 'border-brand-border text-purple-200/75 hover:border-brand-border/80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setCategories(prev =>
                          checked ? prev.filter(c => c !== cat) : [...prev, cat]
                        )
                      }
                      className="accent-brand-orange w-3.5 h-3.5 flex-shrink-0"
                    />
                    {cat}
                  </label>
                );
              })}
            </div>
          </OrgField>

          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={loading} className="btn-primary px-8 py-3 disabled:opacity-40">
              {loading ? 'Creating…' : 'Create channel'}
            </button>
            <Link href="/dashboard" className="btn-ghost px-6 py-3">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function OrgField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-white mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-purple-200/70 mt-1.5">{hint}</p>}
    </div>
  );
}
