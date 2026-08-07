'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, getUser } from '@/lib/auth';
import type { UserProfile, Session } from '@ask-away/shared/types';
import AppNav from '@/components/AppNav';

interface ProfileSession {
  id: string;
  title: string;
  slug: string;
  status: 'upcoming' | 'live' | 'closed';
  starts_at: string | null;
  created_at: string;
  participant_count: number;
  question_count: number;
}

export default function UserProfilePage({ params }: { params: { username: string } }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab] = useState<'sessions' | 'followers' | 'following'>('sessions');
  const [tabUsers, setTabUsers] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  const currentUser = mounted ? getUser() : null;
  const isSelf = currentUser?.username === params.username;

  useEffect(() => {
    setMounted(true);
    api.get<{ profile: UserProfile; sessions: ProfileSession[] }>(`/users/${params.username}`)
      .then(data => {
        setProfile(data.profile);
        setSessions(data.sessions);
        setIsFollowing(data.profile.is_following ?? false);
      })
      .catch(err => {
        if (err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [params.username]);

  useEffect(() => {
    if (tab === 'sessions') return;
    setTabLoading(true);
    const endpoint = tab === 'followers'
      ? `/users/${params.username}/followers`
      : `/users/${params.username}/following`;
    api.get<{ users: any[] }>(endpoint)
      .then(d => setTabUsers(d.users))
      .catch(() => setTabUsers([]))
      .finally(() => setTabLoading(false));
  }, [tab, params.username]);

  async function toggleFollow() {
    if (!isLoggedIn()) { router.push(`/login?next=/u/${params.username}`); return; }
    setFollowLoading(true);
    const prev = isFollowing;
    setIsFollowing(!prev);
    setProfile(p => p ? { ...p, follower_count: p.follower_count + (prev ? -1 : 1) } : p);
    try {
      if (prev) {
        await api.delete(`/users/${params.username}/follow`);
      } else {
        await api.post(`/users/${params.username}/follow`, {});
      }
    } catch {
      setIsFollowing(prev);
      setProfile(p => p ? { ...p, follower_count: p.follower_count + (prev ? 1 : -1) } : p);
    } finally {
      setFollowLoading(false);
    }
  }

  if (!mounted) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-purple-200/70 text-sm">Loading…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center gap-4">
        <p className="text-white font-bold text-xl">User not found</p>
        <Link href="/search" className="text-brand-orange hover:text-brand-amber text-sm">Search for people →</Link>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Nav */}
      <AppNav right={
        <>
          <Link href="/search" className="text-sm text-purple-200/75 hover:text-white transition-colors">Find people</Link>
          {isLoggedIn() && (
            <Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>
          )}
        </>
      } />

      <main className="max-w-2xl mx-auto px-4 py-10">
        {/* Profile header */}
        <div className="flex items-start gap-5 mb-8">
          <div className="w-16 h-16 rounded-full bg-brand-border/40 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold text-white">@{profile.username}</h1>
            <p className="text-purple-200/70 text-xs mt-0.5">
              Joined {new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-4 mt-3">
              <button onClick={() => setTab('followers')} className="text-sm hover:text-brand-amber transition-colors">
                <span className="font-bold text-white">{profile.follower_count}</span>
                <span className="text-purple-200/75 ml-1">followers</span>
              </button>
              <button onClick={() => setTab('following')} className="text-sm hover:text-brand-amber transition-colors">
                <span className="font-bold text-white">{profile.following_count}</span>
                <span className="text-purple-200/75 ml-1">following</span>
              </button>
              <span className="text-sm">
                <span className="font-bold text-white">{profile.session_count}</span>
                <span className="text-purple-200/75 ml-1">sessions</span>
              </span>
            </div>
          </div>

          {!isSelf && (
            <button
              onClick={toggleFollow}
              disabled={followLoading}
              className={`flex-shrink-0 px-5 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-40 ${
                isFollowing
                  ? 'border-brand-border text-purple-200/85 hover:border-red-700/50 hover:text-red-400'
                  : 'border-brand-orange bg-brand-orange/10 text-brand-orange hover:bg-brand-orange/20'
              }`}
            >
              {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-brand-border/50">
          {(['sessions', 'followers', 'following'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-brand-orange text-brand-orange'
                  : 'border-transparent text-purple-200/70 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Sessions tab */}
        {tab === 'sessions' && (
          sessions.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-purple-200/70 text-sm">No public sessions yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => (
                <Link
                  key={s.id}
                  href={`/s/${s.slug}`}
                  className="card p-4 flex items-center gap-4 hover:border-brand-purple/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="font-semibold text-white text-sm group-hover:text-brand-amber transition-colors truncate">
                      {s.title}
                    </p>
                    <p className="text-xs text-purple-200/70 mt-0.5">
                      {s.participant_count} joined · {s.question_count} questions
                      {s.starts_at && ` · ${new Date(s.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`}
                    </p>
                  </div>
                  <span className="text-purple-200/50 group-hover:text-brand-orange transition-colors text-lg">›</span>
                </Link>
              ))}
            </div>
          )
        )}

        {/* Followers / Following tabs */}
        {(tab === 'followers' || tab === 'following') && (
          tabLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="card p-4 h-16 animate-pulse bg-brand-card/50" />
              ))}
            </div>
          ) : tabUsers.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-purple-200/70 text-sm">
                {tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {tabUsers.map((u: any) => (
                <div key={u.id} className="card p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-brand-border/40 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/u/${u.username}`} className="font-semibold text-white hover:text-brand-amber transition-colors">
                      @{u.username}
                    </Link>
                    <p className="text-xs text-purple-200/70 mt-0.5">{u.follower_count} followers</p>
                  </div>
                  <Link href={`/u/${u.username}`} className="text-sm text-purple-200/60 hover:text-brand-orange transition-colors">
                    View →
                  </Link>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: ProfileSession['status'] }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
      </span>
    );
  }
  if (status === 'upcoming') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
        Upcoming
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/70 text-xs font-semibold">
      Ended
    </span>
  );
}
