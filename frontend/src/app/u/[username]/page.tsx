'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import type { UserProfile } from '@ask-away/shared/types';
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

/**
 * A person's public identity: who they are and what they have hosted.
 *
 * This used to carry a Follow button, follower and following counts, and tabs
 * listing both. Following is a channel relationship now — you follow a show,
 * not the person behind it — so none of that has anywhere to point. What is
 * left is the part that was always the reason to open this page: which public
 * sessions has this host run.
 */
export default function UserProfilePage({ params }: { params: { username: string } }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<ProfileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.get<{ profile: UserProfile; sessions: ProfileSession[] }>(`/users/${params.username}`)
      .then(data => {
        setProfile(data.profile);
        setSessions(data.sessions);
      })
      .catch(err => {
        if (err.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [params.username]);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <AppNav />
        <main className="max-w-2xl mx-auto px-4 py-10 space-y-3">
          <div className="h-16 rounded-xl bg-brand-card/50 animate-pulse" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4 h-20 animate-pulse bg-brand-card/50" />
          ))}
        </main>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-brand-bg">
        <AppNav />
        <main className="max-w-2xl mx-auto px-4 py-20 text-center">
          <h1 className="text-xl font-bold text-white mb-2">No such person</h1>
          <p className="text-purple-200/70 text-sm">
            Nobody here goes by @{params.username}.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <AppNav right={
        <>
          <Link href="/search" className="text-sm text-purple-200/75 hover:text-white transition-colors">Find people</Link>
          {isLoggedIn() && (
            <Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>
          )}
        </>
      } />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-start gap-5 mb-8">
          <div className="w-16 h-16 rounded-full bg-brand-border/40 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold text-white">@{profile.username}</h1>
            <p className="text-purple-200/70 text-xs mt-0.5">
              Joined {new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </p>
            <p className="text-sm mt-3">
              <span className="font-bold text-white">{profile.session_count}</span>
              <span className="text-purple-200/75 ml-1">
                public {profile.session_count === 1 ? 'session' : 'sessions'}
              </span>
            </p>
          </div>
        </div>

        <h2 className="text-sm font-semibold text-purple-200/85 mb-3">Sessions</h2>

        {sessions.length === 0 ? (
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
