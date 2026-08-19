'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { isLoggedIn, getUser } from '@/lib/auth';
import AppNav from '@/components/AppNav';
import type { UserSearchResult } from '@ask-away/shared/types';
import { Suspense } from 'react';

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [followingState, setFollowingState] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const currentUser = mounted ? getUser() : null;

  // Mount only. `query` is deliberately excluded: the debounced effect below
  // already re-runs the search as the user types, and including it here would
  // fire a second undebounced request on every keystroke.
  useEffect(() => {
    setMounted(true);
    inputRef.current?.focus();
    if (query) doSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function doSearch(q: string) {
    setLoading(true);
    try {
      const data = await api.get<{ users: UserSearchResult[] }>(`/users/search?q=${encodeURIComponent(q)}`);
      setResults(data.users);
      const state: Record<string, boolean> = {};
      data.users.forEach(u => { state[u.id] = u.is_following; });
      setFollowingState(state);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function toggleFollow(user: UserSearchResult) {
    if (!isLoggedIn()) { router.push('/login?next=/search'); return; }
    const currently = followingState[user.id] ?? user.is_following;
    // Optimistic
    setFollowingState(prev => ({ ...prev, [user.id]: !currently }));
    try {
      if (currently) {
        await api.delete(`/users/${user.username}/follow`);
      } else {
        await api.post(`/users/${user.username}/follow`, {});
      }
    } catch {
      // Revert
      setFollowingState(prev => ({ ...prev, [user.id]: currently }));
    }
  }

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Nav */}
      <AppNav right={<Link href="/dashboard" className="text-sm text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>} />

      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-extrabold text-white mb-1">Find people</h1>
        <p className="text-purple-200/75 text-sm mb-6">Search by username to discover hosts and follow their sessions.</p>

        {/* Search input */}
        <div className="relative mb-6">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-200/60 w-4 h-4" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by username…"
            className="w-full bg-brand-card border border-brand-border rounded-2xl pl-10 pr-4 py-3 text-white text-sm focus:outline-none focus:border-brand-purple transition-colors"
          />
          {loading && (
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-purple-200/60 text-xs">Searching…</span>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map(user => {
              const isFollowing = followingState[user.id] ?? user.is_following;
              const isSelf = currentUser?.id === user.id;
              return (
                <div key={user.id} className="card p-4 flex items-center gap-4">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-brand-border/40 flex items-center justify-center flex-shrink-0 text-sm font-bold text-white">
                    {user.username.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/u/${user.username}`} className="font-semibold text-white hover:text-brand-amber transition-colors">
                      @{user.username}
                    </Link>
                    <p className="text-xs text-purple-200/70 mt-0.5">
                      {user.follower_count} {user.follower_count === 1 ? 'follower' : 'followers'}
                      {user.session_count > 0 && ` · ${user.session_count} sessions`}
                    </p>
                  </div>

                  {/* Follow button */}
                  {!isSelf && (
                    <button
                      onClick={() => toggleFollow(user)}
                      className={`text-sm px-4 py-1.5 rounded-lg border font-medium transition-colors flex-shrink-0 ${
                        isFollowing
                          ? 'border-brand-border text-purple-200/85 hover:border-red-700/50 hover:text-red-400'
                          : 'border-brand-orange text-brand-orange hover:bg-brand-orange/10'
                      }`}
                    >
                      {isFollowing ? 'Following' : 'Follow'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && query.trim() && results.length === 0 && (
          <div className="text-center py-16">
            <p className="text-purple-200/70 text-sm">No users found for &quot;<span className="text-white">{query}</span>&quot;</p>
          </div>
        )}

        {!query.trim() && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">👋</div>
            <p className="text-purple-200/70 text-sm">Start typing to find hosts and creators.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}
