'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, resolveAsset } from '@/lib/api';
import { isLoggedIn, isGuest, getUser } from '@/lib/auth';
import LocationAutocomplete, { type LocationResult } from '@/components/LocationAutocomplete';
import { ORG_CATEGORIES } from '@/lib/categories';
import AppNav from '@/components/AppNav';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Org {
  id: string;
  name: string;
  slug: string;
  description?: string;
  website?: string;
  avatar_url?: string;
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  categories?: string[];
  is_online?: boolean;
  created_at: string;
}

interface Member {
  id: string;
  user_id: string;
  username: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: string;
}

interface UserResult { id: string; username: string; }

export default function OrgSettingsPage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const [mounted, setMounted]   = useState(false);
  const [org, setOrg]           = useState<Org | null>(null);
  const [members, setMembers]   = useState<Member[]>([]);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Edit fields
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
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState<{ ok: boolean; text: string } | null>(null);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Add member
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<UserResult[]>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [memberRole, setMemberRole] = useState<'admin' | 'member'>('member');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const loadData = useCallback(async () => {
    try {
      const data = await api.get<{ org: Org; sessions: any[] }>(`/orgs/${params.slug}`);
      setOrg(data.org);
      setName(data.org.name);
      setDescription(data.org.description ?? '');
      setWebsite(data.org.website ?? '');
      setAvatarPreview(resolveAsset(data.org.avatar_url) ?? null);
      setCity(data.org.city ?? '');
      setRegion(data.org.region ?? '');
      setCountry(data.org.country ?? '');
      if (data.org.lat) setLat(data.org.lat);
      if (data.org.lng) setLng(data.org.lng);
      setCategories(data.org.categories ?? []);
      setIsOnline((data.org as any).is_online ?? false);

      const mems = await api.get<Member[]>(`/orgs/${data.org.id}/members`);
      setMembers(mems);
    } catch (err: any) {
      if (err.status === 403 || err.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [params.slug]);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn() || isGuest()) { router.push(`/login?next=/org/${params.slug}/settings`); return; }
    loadData();
  }, [loadData, router]);

  if (!mounted) return null;
  if (loading) return <PageSkeleton />;
  if (notFound || !org) return <NotFound />;

  // ── Save org details ──────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setSaveMsg({ ok: false, text: 'Image must be under 5 MB' }); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return; // form is not rendered until the channel has loaded
    setSaving(true); setSaveMsg(null);
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
        setAvatarFile(null);
      }

      const updated = await api.patch<Org>(`/orgs/${org.id}`, {
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        city:      isOnline ? undefined : city.trim()    || undefined,
        region:    isOnline ? undefined : region.trim()  || undefined,
        country:   isOnline ? undefined : country.trim() || undefined,
        lat:       isOnline ? undefined : lat,
        lng:       isOnline ? undefined : lng,
        is_online: isOnline,
        categories,
        ...(avatar_url ? { avatar_url } : {}),
      });
      setOrg(updated);
      setSaveMsg({ ok: true, text: 'Saved!' });
    } catch (err: any) {
      setSaveMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  // ── Member search ─────────────────────────────────────────────────────────

  function onMemberSearchChange(v: string) {
    setMemberSearch(v);
    clearTimeout(searchTimer.current);
    if (v.trim().length < 2) { setMemberResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await api.get<UserResult[]>(`/auth/users/search?q=${encodeURIComponent(v.trim())}`);
        const memberIds = new Set(members.map(m => m.user_id));
        setMemberResults(rows.filter(r => !memberIds.has(r.id)));
      } catch {}
    }, 300);
  }

  async function addMember(user: UserResult) {
    if (!org) return;
    setAddingMember(true);
    try {
      await api.post(`/orgs/${org.id}/members`, { user_id: user.id, role: memberRole });
      setMemberSearch(''); setMemberResults([]);
      await loadData();
    } catch (err: any) {
      setSaveMsg({ ok: false, text: err.message });
    } finally { setAddingMember(false); }
  }

  async function removeMember(userId: string) {
    if (!org) return;
    try {
      await api.delete(`/orgs/${org.id}/members/${userId}`);
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err: any) {
      setSaveMsg({ ok: false, text: err.message });
    }
  }

  const currentUserId = getUser()?.id;
  const myRole = members.find(m => m.user_id === currentUserId)?.role;
  const isOwner = myRole === 'owner';

  async function deleteChannel() {
    if (!org) return;
    if (!confirm(`Delete "${org.name}"? This will permanently remove the channel. Sessions posted under it will become personal sessions.`)) return;
    setDeletingChannel(true);
    try {
      await api.delete(`/orgs/${org.id}`);
      router.push('/dashboard');
    } catch (err: any) {
      setSaveMsg({ ok: false, text: err.message ?? 'Failed to delete channel' });
      setDeletingChannel(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={
        <>
          <Link href={`/org/${org.slug}`} className="text-sm text-purple-200/75 hover:text-white transition-colors">View page</Link>
          <Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>
        </>
      } />

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white">{org.name}</h1>
          <p className="text-purple-200/70 text-sm mt-0.5">Channel settings</p>
        </div>

        {/* ── Profile ───────────────────────────────────────────────────── */}
        <form onSubmit={saveDetails} className="card p-6 space-y-4">
          <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Profile</h2>

          {/* Avatar */}
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-20 h-20 rounded-full bg-brand-bg border-2 border-dashed border-brand-border hover:border-brand-purple transition-colors flex-shrink-0 overflow-hidden group"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Channel photo" className="w-full h-full object-cover" />
              ) : (
                <div className="flex items-center justify-center h-full">
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
              <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 text-xs text-brand-orange hover:text-brand-amber transition-colors">
                {avatarPreview ? 'Change photo' : 'Upload photo'}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileChange} className="hidden" />
          </div>

          <OrgField label="Name">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={255} className="input" />
          </OrgField>

          <OrgField label="Description">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              className="input resize-none"
            />
          </OrgField>

          <OrgField label="Website">
            <input
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://"
              type="url"
              className="input"
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
              <OrgField label="Location" hint="Helps people nearby discover your channel.">
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

          <OrgField label="Categories" hint="Select all that apply — helps people find you by type.">
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

          <div className="flex items-center gap-4 pt-1">
            <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {saveMsg && (
              <p className={`text-sm font-medium ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {saveMsg.text}
              </p>
            )}
          </div>
        </form>

        {/* ── Members ──────────────────────────────────────────────────── */}
        <div className="card p-6 space-y-5">
          <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Members</h2>

          {/* Add member */}
          <div className="space-y-3">
            <p className="text-xs text-purple-200/75 font-semibold">Add member</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  value={memberSearch}
                  onChange={e => onMemberSearchChange(e.target.value)}
                  placeholder="Search by username…"
                  className="input"
                />
                {memberResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-brand-card border border-brand-border rounded-xl overflow-hidden z-10 shadow-xl">
                    {memberResults.map(u => (
                      <button
                        key={u.id}
                        onClick={() => addMember(u)}
                        disabled={addingMember}
                        className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-brand-border/20 transition-colors flex items-center justify-between"
                      >
                        <span>@{u.username}</span>
                        <span className="text-xs text-brand-orange">Add as {memberRole}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select
                value={memberRole}
                onChange={e => setMemberRole(e.target.value as 'admin' | 'member')}
                className="input w-auto flex-shrink-0"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <p className="text-xs text-purple-200/60">
              Admins can manage all sessions and members. Members are listed under the channel but have no special access.
            </p>
          </div>

          {/* Member list */}
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between py-2 border-b border-brand-border/20 last:border-0">
                <div>
                  <span className="text-sm text-white font-medium">@{m.username}</span>
                </div>
                <div className="flex items-center gap-3">
                  <RoleBadge role={m.role} />
                  {isOwner && m.role !== 'owner' && (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      className="text-xs text-red-400/50 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Public page ──────────────────────────────────────────────── */}
        <div className="card p-6 space-y-3">
          <h2 className="text-xs font-bold text-brand-orange uppercase tracking-widest">Public page</h2>
          <p className="text-sm text-purple-200/75">
            Your public channel page is at{' '}
            <Link href={`/org/${org.slug}`} className="text-brand-orange hover:underline">
              /org/{org.slug}
            </Link>
            . Followers will be notified when your channel goes live.
          </p>
        </div>

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        {isOwner && (
          <div className="card p-6 border-red-900/40 space-y-3">
            <h2 className="text-xs font-bold text-red-400/70 uppercase tracking-widest">Danger zone</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">Delete this channel</p>
                <p className="text-xs text-purple-200/70 mt-0.5">
                  Permanently removes the channel. Past sessions become personal sessions.
                </p>
              </div>
              <button
                onClick={deleteChannel}
                disabled={deletingChannel}
                className="flex-shrink-0 text-sm px-4 py-2 rounded-xl border border-red-700/50 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
              >
                {deletingChannel ? 'Deleting…' : 'Delete channel'}
              </button>
            </div>
          </div>
        )}
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

function RoleBadge({ role }: { role: string }) {
  const styles = {
    owner: 'bg-brand-orange/20 text-brand-orange',
    admin: 'bg-brand-purple/20 text-brand-amber',
    member: 'bg-brand-border/20 text-purple-200/75',
  }[role] ?? 'bg-brand-border/20 text-purple-200/75';

  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles}`}>
      {role}
    </span>
  );
}

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-4">
        {[1,2,3].map(i => <div key={i} className="card p-6 h-40 animate-pulse bg-brand-card/50" />)}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="text-center card p-8 max-w-sm">
        <p className="text-4xl mb-3">🔒</p>
        <h2 className="text-white font-bold text-lg mb-2">Not found</h2>
        <p className="text-purple-200/75 text-sm mb-6">This channel doesn&apos;t exist or you don&apos;t have access.</p>
        <Link href="/dashboard" className="btn-primary">Go to dashboard</Link>
      </div>
    </div>
  );
}
