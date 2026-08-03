'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, sseUrl } from '@/lib/api';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
import ModeratorPanel from '@/components/ModeratorPanel';
import GuestUsernameModal from '@/components/GuestUsernameModal';
import QRCode from 'react-qr-code';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionPageProps {
  params: { slug: string };
}

type SortOption = 'echoes' | 'recent' | 'answered' | 'starred';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SessionPageClient({ params }: SessionPageProps) {
  const router = useRouter();
  const [session, setSession]               = useState<Session & { caller_role?: CallerRole } | null>(null);
  const [questions, setQuestions]           = useState<Question[]>([]);
  const [credits, setCredits]               = useState<number>(3);
  const [sort, setSort]                     = useState<SortOption>('echoes');
  const [searchQuery, setSearchQuery]       = useState('');
  const [body, setBody]                     = useState('');
  const [similarQuestions, setSimilarQuestions] = useState<Question[]>([]);
  const [submitting, setSubmitting]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [echoedIds, setEchoedIds]           = useState<Set<string>>(new Set());
  const [myQuestionIds, setMyQuestionIds]   = useState<Set<string>>(new Set());
  const [loading, setLoading]               = useState(true);

  // Host/mod overlay
  const [hostView, setHostView]             = useState(false);
  const [showModPanel, setShowModPanel]     = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<Question[]>([]);
  const [showPending, setShowPending]       = useState(false);
  const [replyTarget, setReplyTarget]       = useState<Question | null>(null);
  const [replyText, setReplyText]           = useState('');
  const [replyLoading, setReplyLoading]     = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [reopeningSession, setReopeningSession] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);

  const [showUsernamePicker, setShowUsernamePicker] = useState(false);
  const [isRegistered, setIsRegistered]             = useState(false);
  const [postAnonymously, setPostAnonymously]       = useState(false);

  // Credit regen countdown (seconds until next credit)
  const CREDIT_CAP = 6;
  const REGEN_SECS = 10 * 60; // 10 minutes
  const [nextCreditSecs, setNextCreditSecs] = useState(REGEN_SECS);

  // Live UX
  const [showWelcome, setShowWelcome]             = useState(false);
  const [participantCount, setParticipantCount]   = useState<number | null>(null);
  const [newQuestionsCount, setNewQuestionsCount] = useState(0);
  const atTopRef = useRef(true);

  const similarTimer = useRef<ReturnType<typeof setTimeout>>();
  const sseRef = useRef<EventSource | null>(null);

  // ── Load session ──────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        const s = await api.get<Session & { caller_role: CallerRole }>(`/sessions/${params.slug}`);
        setSession(s);
        setCredits(s.credits_per_user);
        setParticipantCount((s as any).participant_count ?? null);

        // Show welcome screen for first-time visitors (not hosts/mods, not closed sessions)
        const hasSeen = sessionStorage.getItem(`seen_${params.slug}`);
        const isHostOrMod = ['host', 'org_owner', 'org_admin', 'moderator'].includes(s.caller_role ?? 'none');
        if (!hasSeen && s.status !== 'closed' && !isHostOrMod) {
          setShowWelcome(true);
        }

        // Hosts and mods start in host view — they're here to run the session
        if (isHostOrMod) setHostView(true);

        // Determine how to join based on who's viewing
        const isRegistered = !!localStorage.getItem('aa_user');
        setIsRegistered(isRegistered);
        const savedGuestName = localStorage.getItem('aa_guest_username');

        if (isRegistered) {
          // Registered user — silent auto-join
          try {
            const joined = await api.post<{ credits_remaining: number }>(`/sessions/${s.id}/join`, {});
            setCredits(joined.credits_remaining);
          } catch (err: any) {
            if (err?.status !== 410 && err?.status !== 403) setCredits(0);
          }
        } else if (savedGuestName && s.status !== 'closed') {
          // Returning guest — refresh JWT if needed, then rejoin with stored name
          try {
            if (!localStorage.getItem('aa_token')) {
              const { token } = await api.post<{ token: string }>('/auth/guest', {});
              localStorage.setItem('aa_token', token);
            }
            const joined = await api.post<{ credits_remaining: number }>(`/sessions/${s.id}/join`, {
              guest_username: savedGuestName,
            });
            setCredits(joined.credits_remaining);
          } catch (err: any) {
            // Name conflict after re-issue: show picker so they can choose another
            if (err?.status === 409) {
              localStorage.removeItem('aa_guest_username');
              setShowUsernamePicker(true);
            } else if (err?.status !== 410 && err?.status !== 403) {
              setCredits(0);
            }
          }
        } else if (s.status !== 'closed') {
          // New guest on an active session — show username picker
          setShowUsernamePicker(true);
        }

        const result = await api.get<{ data: Question[] }>(`/questions?sessionId=${s.id}&sort=${sort}`);
        setQuestions(result.data);

        // Fetch pending queue for hosts/mods on sessions with approval required
        if (isHostOrMod && s.requires_approval) {
          api.get<{ data: Question[] }>(`/questions?sessionId=${s.id}&status=pending`)
            .then(r => setPendingQuestions(r.data))
            .catch(() => {});
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [params.slug]);

  // ── SSE real-time updates ─────────────────────────────────────────────────

  useEffect(() => {
    if (!session) return;
    const sessionId = session.id;
    let reconnecting = false;

    const es = new EventSource(sseUrl(sessionId));
    sseRef.current = es;

    // On reconnect (open fires again after a drop), re-fetch the full question
    // list so any events missed during the disconnection are caught up.
    es.addEventListener('open', () => {
      if (!reconnecting) { reconnecting = true; return; } // skip the initial open
      api.get<{ data: Question[] }>(`/questions?sessionId=${sessionId}&sort=${sort}`)
        .then(r => setQuestions(r.data))
        .catch(() => {});
    });

    es.addEventListener('question:new', (e) => {
      const q: Question = JSON.parse(e.data);
      if (q.status === 'pending') {
        // Route pending questions to the approval queue for hosts/mods
        setPendingQuestions(prev => [q, ...prev]);
      } else {
        setQuestions(prev => [q, ...prev]);
        if (!atTopRef.current) setNewQuestionsCount(n => n + 1);
      }
    });
    es.addEventListener('echo:added', (e) => {
      const { questionId, vote_count } = JSON.parse(e.data);
      setQuestions(prev => prev.map(q => q.id === questionId ? { ...q, vote_count } : q));
    });
    es.addEventListener('question:updated', (e) => {
      const updated: Question = JSON.parse(e.data);
      setQuestions(prev => prev.map(q => q.id === updated.id ? updated : q));
    });
    es.addEventListener('session:live', () => {
      setSession(prev => prev ? { ...prev, status: 'live' } : prev);
    });
    es.addEventListener('session:closed', () => {
      setSession(prev => prev ? { ...prev, status: 'closed' } : prev);
    });
    // Live participant count — broadcast when someone joins
    es.addEventListener('participant:count', (e) => {
      const { count } = JSON.parse(e.data);
      setParticipantCount(count);
    });
    // Now Answering spotlight — clear all and set the spotlighted one
    es.addEventListener('session:spotlight', (e) => {
      const { question_id } = JSON.parse(e.data);
      setQuestions(prev => prev.map(q => ({ ...q, is_spotlighted: q.id === question_id })));
    });

    return () => es.close();
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sort change ───────────────────────────────────────────────────────────

  useEffect(() => {
    // Only re-fetch when sort changes; initial load is handled by the init effect above
    if (!session) return;
    api.get<{ data: Question[] }>(`/questions?sessionId=${session.id}&sort=${sort}`)
      .then(r => setQuestions(r.data))
      .catch(() => {});
  }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll tracker (new questions badge) ─────────────────────────────────

  useEffect(() => {
    function onScroll() {
      const top = window.scrollY < 100;
      atTopRef.current = top;
      if (top) setNewQuestionsCount(0);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── Auto-dismiss error toast ──────────────────────────────────────────────

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // ── Credit regen heartbeat ────────────────────────────────────────────────

  useEffect(() => {
    if (!session || session.status === 'closed') return;
    // Hosts/mods skip the regen countdown
    const callerRole = session.caller_role ?? 'none';
    if (['host', 'org_owner', 'org_admin', 'moderator'].includes(callerRole)) return;

    const interval = setInterval(() => {
      setNextCreditSecs(prev => {
        if (prev <= 1) {
          // Time's up — send heartbeat
          api.post<{ credits_remaining: number }>(`/sessions/${session.id}/heartbeat`, {})
            .then(r => setCredits(r.credits_remaining))
            .catch(() => {});
          return REGEN_SECS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.id, session?.status, session?.caller_role]);

  // ── Similar detection ─────────────────────────────────────────────────────

  const fetchSimilar = useCallback((q: string) => {
    if (!session || q.trim().length < 10) { setSimilarQuestions([]); return; }
    clearTimeout(similarTimer.current);
    similarTimer.current = setTimeout(async () => {
      try {
        const results = await api.get<Question[]>(
          `/questions/similar?sessionId=${session.id}&q=${encodeURIComponent(q)}`
        );
        setSimilarQuestions(results);
      } catch { setSimilarQuestions([]); }
    }, 400);
  }, [session?.id]);

  // ── Submit question ───────────────────────────────────────────────────────

  async function submitQuestion() {
    if (!session || !body.trim()) return;
    if (!isMod && credits < 1) return;
    setSubmitting(true); setError(null);
    try {
      const q = await api.post<Question>('/questions', {
        session_id: session.id,
        body: body.trim(),
        ...(postAnonymously && { post_anonymously: true }),
      });
      setBody(''); setSimilarQuestions([]);
      setCredits(c => c - 1);
      setMyQuestionIds(prev => new Set([...prev, q.id]));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Add Echo ──────────────────────────────────────────────────────────────

  async function addEcho(questionId: string) {
    if (credits < 1 || echoedIds.has(questionId)) return;
    try {
      await api.post<{ vote_count: number }>(`/questions/${questionId}/echo`, {});
      setCredits(c => c - 1);
      setEchoedIds(prev => new Set([...prev, questionId]));
    } catch (err: any) { setError(err.message); }
  }

  // ── Mod actions ───────────────────────────────────────────────────────────

  async function setQuestionStatus(questionId: string, status: string) {
    try {
      await api.patch(`/questions/${questionId}/status`, { status });
    } catch (err: any) { setError(err.message); }
  }

  async function approveQuestion(questionId: string) {
    try {
      const approved = await api.patch<Question>(`/questions/${questionId}/approve`, {});
      setPendingQuestions(prev => prev.filter(q => q.id !== questionId));
      setQuestions(prev => [approved, ...prev]);
    } catch (err: any) { setError(err.message); }
  }

  async function rejectQuestion(questionId: string) {
    try {
      await api.patch(`/questions/${questionId}/status`, { status: 'hidden' });
      setPendingQuestions(prev => prev.filter(q => q.id !== questionId));
    } catch (err: any) { setError(err.message); }
  }

  async function togglePin(questionId: string) {
    try {
      await api.patch(`/questions/${questionId}/pin`, {});
    } catch (err: any) { setError(err.message); }
  }

  async function toggleSpotlight(questionId: string) {
    try {
      await api.patch(`/questions/${questionId}/spotlight`, {});
    } catch (err: any) { setError(err.message); }
  }

  async function muteAuthor(participantId: string, currentlyMuted: boolean) {
    if (!session) return;
    try {
      await api.patch(`/sessions/${session.id}/participants/${participantId}/mute`, { mute: !currentlyMuted });
      // Optimistically update muted state on all questions by this participant
      setQuestions(prev => prev.map(q =>
        q.participant_id === participantId ? { ...q, author_is_muted: !currentlyMuted } : q
      ));
    } catch (err: any) { setError(err.message); }
  }

  async function removeAuthor(participantId: string) {
    if (!session) return;
    if (!confirm('Remove this person from the session? They will not be able to rejoin.')) return;
    try {
      await api.delete(`/sessions/${session.id}/participants/${participantId}`);
      // Remove their questions from the local feed
      setQuestions(prev => prev.filter(q => q.participant_id !== participantId));
    } catch (err: any) { setError(err.message); }
  }

  function dismissWelcome() {
    sessionStorage.setItem(`seen_${params.slug}`, '1');
    setShowWelcome(false);
  }

  async function handleExport() {
    if (!session) return;
    const token = localStorage.getItem('aa_token');
    const res = await fetch(`${API_BASE}/api/sessions/${session.id}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError('Export failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.headers.get('content-disposition')?.split('filename="')[1]?.replace('"', '') ?? 'qa.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitReply() {
    if (!replyTarget || !replyText.trim()) return;
    setReplyLoading(true);
    try {
      await api.patch(`/questions/${replyTarget.id}/reply`, { reply: replyText.trim() });
      setReplyTarget(null); setReplyText('');
    } catch (err: any) { setError(err.message); }
    finally { setReplyLoading(false); }
  }

  async function goLive() {
    if (!session) return;
    try {
      await api.post(`/sessions/${session.id}/go-live`, {});
      setSession(prev => prev ? { ...prev, status: 'live' } : prev);
    } catch (err: any) { setError(err.message); }
  }

  async function closeSession() {
    if (!session) return;
    setClosingSession(true);
    try {
      await api.post(`/sessions/${session.id}/close`, {});
      setSession(prev => prev ? { ...prev, status: 'closed' } : prev);
    } catch (err: any) { setError(err.message); }
    finally { setClosingSession(false); }
  }

  async function handleDelete() {
    if (!session) return;
    if (!confirm(`Delete "${session.title}"? This cannot be undone.`)) return;
    setDeletingSession(true);
    try {
      await api.delete(`/sessions/${session.id}`);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete session');
      setDeletingSession(false);
    }
  }

  async function handleReopen() {
    if (!session) return;
    if (!confirm('Reopen this session? It will go live again and accept new questions.')) return;
    setReopeningSession(true);
    try {
      const updated = await api.post<typeof session>(`/sessions/${session.id}/reopen`, {});
      setSession(updated);
    } catch (err: any) {
      setError(err.message ?? 'Failed to reopen session');
    } finally {
      setReopeningSession(false);
    }
  }

  async function handleJoinAsGuest(username: string) {
    if (!session) return;
    if (!localStorage.getItem('aa_token')) {
      const { token } = await api.post<{ token: string }>('/auth/guest', {});
      localStorage.setItem('aa_token', token);
    }
    localStorage.setItem('aa_guest_username', username);
    const joined = await api.post<{ credits_remaining: number }>(`/sessions/${session.id}/join`, {
      guest_username: username,
    });
    setCredits(joined.credits_remaining);
    setShowUsernamePicker(false);
  }

  // ── Display ───────────────────────────────────────────────────────────────

  const callerRole = session?.caller_role ?? 'none';
  const isMod = ['host', 'org_owner', 'org_admin', 'moderator'].includes(callerRole);

  const displayedQuestions = [...questions].filter(q => {
    if (q.status === 'hidden' && !(isMod && hostView)) return false;
    // Starred/Answered tabs are filters, not just sort orders
    if (sort === 'starred'  && !searchQuery && q.status !== 'starred')  return false;
    if (sort === 'answered' && !searchQuery && q.status !== 'answered') return false;
    if (!searchQuery) return true;
    return q.body.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => {
    // Spotlighted question always first (Now Answering)
    if ((a as any).is_spotlighted !== (b as any).is_spotlighted) return (b as any).is_spotlighted ? 1 : -1;
    // Pinned float above normal
    if ((a as any).is_pinned !== (b as any).is_pinned) return (b as any).is_pinned ? 1 : -1;
    if (sort === 'echoes')   return b.vote_count - a.vote_count || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sort === 'recent')   return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (sort === 'answered') return (b.status === 'answered' ? 1 : 0) - (a.status === 'answered' ? 1 : 0);
    if (sort === 'starred')  return (b.status === 'starred'  ? 1 : 0) - (a.status === 'starred'  ? 1 : 0);
    return 0;
  });

  const submissionClosed = session?.submission_cutoff_at
    ? new Date() > new Date(session.submission_cutoff_at)
    : session?.status === 'closed';

  const isLiveSoon = session?.status === 'upcoming' && session.starts_at
    && (new Date(session.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  if (loading) return <LoadingScreen />;
  if (error && !session) return <ErrorScreen message={error} />;
  if (!session) return null;

  // Separate featured (top) question from the rest
  const featuredQuestion = sort === 'echoes' && displayedQuestions.length > 0 && !searchQuery
    ? displayedQuestions[0]
    : null;
  const listQuestions = featuredQuestion ? displayedQuestions.slice(1) : displayedQuestions;

  return (
    <div className="min-h-[100dvh] bg-brand-bg flex flex-col">
      <SessionHeader
        session={session}
        isLiveSoon={!!isLiveSoon}
        credits={credits}
        isMod={isMod}
        hostView={hostView}
        participantCount={participantCount}
        nextCreditSecs={!isMod ? nextCreditSecs : undefined}
        creditCap={CREDIT_CAP}
        onToggleHostView={() => setHostView(v => !v)}
      />

      {/* Host controls bar */}
      {isMod && hostView && (
        <HostControlBar
          session={session}
          closing={closingSession}
          reopening={reopeningSession}
          deleting={deletingSession}
          onGoLive={goLive}
          onClose={closeSession}
          onReopen={handleReopen}
          onDelete={handleDelete}
          onExport={handleExport}
          onManageMods={() => setShowModPanel(true)}
          callerRole={callerRole}
        />
      )}

      {/* 3-pane layout: left sidebar + center feed + right sidebar */}
      <div className="flex flex-1 max-w-7xl mx-auto w-full">

        {/* ── Left sidebar (desktop only) ─────────────────────────────────── */}
        <aside className="hidden lg:flex flex-col w-56 xl:w-64 border-r border-brand-border shrink-0 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
          <div className="p-5 flex flex-col gap-5">
            <div>
              <p className="text-[10px] font-bold text-purple-200/50 uppercase tracking-widest mb-3">Session</p>
              <h2 className="font-bold text-white text-sm leading-snug mb-1">{session.title}</h2>
              {session.host_username && (
                <p className="text-xs text-purple-200/60">Hosted by <span className="text-brand-amber font-semibold">{session.host_username}</span></p>
              )}
              {session.org_name && (
                <Link href={`/org/${session.org_slug}`} className="text-xs text-brand-orange/70 hover:text-brand-orange mt-0.5 flex items-center gap-1">
                  {session.org_name}
                  {session.org_is_verified && (
                    <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-brand-orange text-white flex-shrink-0">
                      <svg viewBox="0 0 24 24" className="w-1.5 h-1.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                </Link>
              )}
            </div>

            {/* Stats */}
            <div className="border-t border-brand-border/40 pt-4 flex flex-col gap-3">
              {[
                { label: 'Questions', value: questions.length },
                { label: 'Unanswered', value: questions.filter(q => q.status !== 'answered').length },
                { label: 'Answered', value: questions.filter(q => q.status === 'answered').length },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-xs text-purple-200/60">{s.label}</span>
                  <span className="text-lg font-bold text-white">{s.value}</span>
                </div>
              ))}
              {participantCount !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-purple-200/60">Attending</span>
                  <span className="text-lg font-bold text-white flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                    {participantCount}
                  </span>
                </div>
              )}
            </div>

            {/* Join code card */}
            {session.join_code && session.status !== 'closed' && (
              <div className="mt-auto border-t border-brand-border/40 pt-4">
                <div className="rounded-xl bg-brand-purple/15 border border-brand-purple/25 p-3.5 text-center">
                  <p className="text-xs font-bold text-purple-200/70 mb-1">Join code</p>
                  <p className="text-xl font-bold text-brand-amber tracking-[0.2em] mb-2">{session.join_code}</p>
                  <p className="text-xs text-brand-orange font-semibold">guestspeak.app</p>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ── Center feed ─────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 pb-[calc(8rem+env(safe-area-inset-bottom))] pt-4 px-3 sm:px-5 lg:px-6 overflow-y-auto">

          {/* Stream embed */}
          {session.stream_url && (
            <StreamEmbed url={session.stream_url} sessionSlug={session.slug} />
          )}

          {/* Closed session stats banner */}
          {session.status === 'closed' && (
            <div className="card p-4 mb-6 flex flex-wrap gap-6 items-center">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-white">{(session as any).question_count ?? questions.length}</p>
                <p className="text-xs text-purple-200/40 mt-0.5">Questions</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-white">{(session as any).participant_count ?? '—'}</p>
                <p className="text-xs text-purple-200/40 mt-0.5">Participants</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-brand-amber">{(session as any).total_echoes ?? '—'}</p>
                <p className="text-xs text-purple-200/40 mt-0.5">Total Echoes</p>
              </div>
              {session.ends_at && (
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">{new Date(session.ends_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  <p className="text-xs text-purple-200/40 mt-0.5">Session date</p>
                </div>
              )}
            </div>
          )}

          {/* Search */}
          <div className="relative mb-4">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-border w-4 h-4" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search questions…"
              className="w-full bg-brand-card border border-brand-border rounded-xl pl-9 pr-4 py-3
                         text-white text-base placeholder-purple-200/40 focus:outline-none focus:border-brand-purple transition-colors"
            />
          </div>

          {/* Pending approval queue */}
          {isMod && hostView && session.requires_approval && (
            <div className="mb-4">
              <button
                onClick={() => setShowPending(v => !v)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                  pendingQuestions.length > 0
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-brand-card border-brand-border/50 text-purple-200/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Pending approval</span>
                  {pendingQuestions.length > 0 && (
                    <span className="text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                      {pendingQuestions.length}
                    </span>
                  )}
                </div>
                <svg className={`w-4 h-4 transition-transform ${showPending ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {showPending && (
                <div className="mt-2 space-y-2">
                  {pendingQuestions.length === 0 && (
                    <p className="text-center text-xs text-purple-200/30 py-4">No questions waiting for approval.</p>
                  )}
                  {pendingQuestions.map(q => (
                    <div key={q.id} className="card p-4 border-amber-500/20">
                      <p className="text-white text-sm leading-relaxed mb-1">{q.body}</p>
                      {q.author_username && <p className="text-xs text-purple-200/30 mb-3">{q.author_username}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => approveQuestion(q.id)} className="flex-1 text-sm py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold hover:bg-emerald-500/20 transition-colors min-h-[44px]">✓ Approve</button>
                        <button onClick={() => { if (confirm('Reject this question?')) rejectQuestion(q.id); }} className="flex-1 text-sm py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-semibold hover:bg-red-500/20 transition-colors min-h-[44px]">✕ Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sort tabs */}
          <SortTabs sort={sort} onChange={setSort} />

          <div className="space-y-3 mt-4">
            {/* Featured top question */}
            {featuredQuestion && (
              <FeaturedQuestionCard
                question={featuredQuestion}
                isEchoed={echoedIds.has(featuredQuestion.id)}
                isMine={myQuestionIds.has(featuredQuestion.id)}
                creditsLeft={credits}
                onEcho={() => addEcho(featuredQuestion.id)}
                hostView={isMod && hostView}
                onStar={() => setQuestionStatus(featuredQuestion.id, featuredQuestion.status === 'starred' ? 'new' : 'starred')}
                onAnswered={() => setQuestionStatus(featuredQuestion.id, featuredQuestion.status === 'answered' ? 'new' : 'answered')}
                onHide={() => setQuestionStatus(featuredQuestion.id, featuredQuestion.status === 'hidden' ? 'new' : 'hidden')}
                onPin={() => togglePin(featuredQuestion.id)}
                onSpotlight={() => toggleSpotlight(featuredQuestion.id)}
                onReply={() => { setReplyTarget(featuredQuestion); setReplyText(featuredQuestion.host_reply ?? ''); }}
                onMute={featuredQuestion.participant_id && !myQuestionIds.has(featuredQuestion.id) ? () => muteAuthor(featuredQuestion.participant_id!, !!featuredQuestion.author_is_muted) : undefined}
                onRemove={featuredQuestion.participant_id && !myQuestionIds.has(featuredQuestion.id) ? () => removeAuthor(featuredQuestion.participant_id!) : undefined}
                sessionClosed={session.status === 'closed'}
              />
            )}

            {/* Remaining questions */}
            {listQuestions.length === 0 && !featuredQuestion && (
              <div className="text-center py-16 text-purple-200/40">
                <p className="text-4xl mb-3">
                  {sort === 'starred' ? '★' : sort === 'answered' ? '✓' : '❓'}
                </p>
                <p className="font-medium">
                  {sort === 'starred'  ? 'No starred questions yet.'   :
                   sort === 'answered' ? 'No answered questions yet.'  :
                   'No questions yet.'}
                </p>
                <p className="text-sm mt-1">
                  {sort === 'starred'  ? 'Star a question to save it here.' :
                   sort === 'answered' ? 'Questions appear here once marked answered.' :
                   'Be the first to ask something.'}
                </p>
              </div>
            )}
            {listQuestions.map(q => (
              <QuestionCard
                key={q.id}
                question={q}
                isEchoed={echoedIds.has(q.id)}
                isMine={myQuestionIds.has(q.id)}
                creditsLeft={credits}
                onEcho={() => addEcho(q.id)}
                hostView={isMod && hostView}
                onStar={() => setQuestionStatus(q.id, q.status === 'starred' ? 'new' : 'starred')}
                onAnswered={() => setQuestionStatus(q.id, q.status === 'answered' ? 'new' : 'answered')}
                onHide={() => setQuestionStatus(q.id, q.status === 'hidden' ? 'new' : 'hidden')}
                onPin={() => togglePin(q.id)}
                onSpotlight={() => toggleSpotlight(q.id)}
                onReply={() => { setReplyTarget(q); setReplyText(q.host_reply ?? ''); }}
                onMute={q.participant_id && !myQuestionIds.has(q.id) ? () => muteAuthor(q.participant_id!, !!q.author_is_muted) : undefined}
                onRemove={q.participant_id && !myQuestionIds.has(q.id) ? () => removeAuthor(q.participant_id!) : undefined}
                sessionClosed={session.status === 'closed'}
              />
            ))}
          </div>
        </main>

        {/* ── Right sidebar (desktop only) ────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col w-64 border-l border-brand-border shrink-0 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
          <div className="p-5">
            <p className="text-[10px] font-bold text-purple-200/50 uppercase tracking-widest mb-4">Top Questions</p>
            <div className="flex flex-col gap-3">
              {questions
                .filter(q => q.status !== 'hidden' && q.status !== 'answered')
                .sort((a, b) => b.vote_count - a.vote_count)
                .slice(0, 5)
                .map((q, i) => (
                  <div key={q.id} className="flex items-start gap-2.5">
                    <span className={`text-xs font-bold w-4 shrink-0 mt-0.5 ${i === 0 ? 'text-brand-amber' : 'text-purple-200/25'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-purple-200/80 leading-relaxed line-clamp-2">{q.body}</p>
                      <p className="text-[11px] text-brand-orange mt-0.5">{q.vote_count} echoes</p>
                    </div>
                  </div>
                ))}
              {questions.filter(q => q.status !== 'hidden').length === 0 && (
                <p className="text-xs text-purple-200/40 text-center py-4">No questions yet</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Submit bar */}
      {!submissionClosed && (
        <SubmitBar
          body={body}
          setBody={(v) => { setBody(v); fetchSimilar(v); }}
          credits={credits}
          submitting={submitting}
          similarQuestions={similarQuestions}
          onSubmit={submitQuestion}
          onEchoSimilar={addEcho}
          sessionStatus={session.status}
          isRegistered={isRegistered}
          postAnonymously={postAnonymously}
          onToggleAnon={() => setPostAnonymously(p => !p)}
          isMod={isMod}
        />
      )}

      {submissionClosed && session.status !== 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-purple-200/60">
          Question submission has closed for this session.
        </div>
      )}

      {session.status === 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-purple-200/60">
          This session has ended. Questions are archived below.
        </div>
      )}

      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] bg-red-900/90 text-red-300 text-sm px-4 py-2.5 rounded-xl border border-red-700 z-50 flex items-center gap-3 shadow-xl">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-300 transition-colors flex-shrink-0" aria-label="Dismiss">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* New questions badge — shown when scrolled down and new questions arrive */}
      {newQuestionsCount > 0 && (
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setNewQuestionsCount(0);
          }}
          className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-40
                     bg-brand-purple text-white text-sm font-bold
                     px-5 py-3 rounded-full shadow-xl border border-brand-purple/60
                     hover:bg-brand-purple/90 transition-colors flex items-center gap-1.5 min-h-[44px]"
        >
          ↑ {newQuestionsCount} new question{newQuestionsCount !== 1 ? 's' : ''}
        </button>
      )}

      {/* Welcome screen — first-time visitors see this before anything else */}
      {showWelcome && session && (
        <WelcomeScreen session={session} onEnter={dismissWelcome} />
      )}

      {/* Guest username picker — only after welcome is dismissed */}
      {!showWelcome && showUsernamePicker && session && (
        <GuestUsernameModal
          sessionTitle={session.title}
          onJoin={handleJoinAsGuest}
        />
      )}

      {/* Moderator panel */}
      {showModPanel && session && (
        <ModeratorPanel sessionId={session.id} onClose={() => setShowModPanel(false)} />
      )}

      {/* Reply modal */}
      {replyTarget && (
        <ReplyModal
          question={replyTarget}
          reply={replyText}
          loading={replyLoading}
          onChange={setReplyText}
          onSubmit={submitReply}
          onClose={() => { setReplyTarget(null); setReplyText(''); }}
        />
      )}
    </div>
  );
}

// ─── Session header ───────────────────────────────────────────────────────────

function SessionHeader({ session, isLiveSoon, credits, isMod, hostView, participantCount, nextCreditSecs, creditCap, onToggleHostView }: {
  session: Session;
  isLiveSoon: boolean;
  credits: number;
  isMod: boolean;
  hostView: boolean;
  participantCount: number | null;
  nextCreditSecs?: number;
  creditCap?: number;
  onToggleHostView: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-brand-bg/90 backdrop-blur border-b border-brand-border/50">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusBadge status={session.status} isLiveSoon={isLiveSoon} />
            {session.status === 'live' && participantCount !== null && (
              <span className="text-xs text-purple-200/40 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                {participantCount}
              </span>
            )}
            {session.org_name && (
              <Link href={`/org/${session.org_slug}`} className="text-xs text-brand-orange/70 hover:text-brand-orange truncate flex items-center gap-1">
                {session.org_name}
                {session.org_is_verified && (
                  <span title="Verified" className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-brand-orange text-white flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-2 h-2" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
              </Link>
            )}
          </div>
          <h1 className="text-white font-bold text-base leading-tight truncate">{session.title}</h1>
          {session.host_username && (
            <p className="text-purple-200/50 text-xs mt-0.5">hosted by {session.host_username}</p>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {!isMod && <CreditDisplay credits={credits} max={session.credits_per_user} nextCreditSecs={nextCreditSecs} creditCap={creditCap} />}
          {isMod && (
            <button
              onClick={onToggleHostView}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                hostView
                  ? 'bg-brand-orange/20 border-brand-orange text-brand-orange'
                  : 'border-brand-border text-purple-200/50 hover:border-brand-orange hover:text-brand-orange'
              }`}
            >
              {hostView ? '★ Host view' : 'Host view'}
            </button>
          )}
          {!isMod && (
            <Link href="/" className="text-xs text-purple-200/30 hover:text-purple-200/60">GuestSpeak</Link>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Host control bar ─────────────────────────────────────────────────────────

function HostControlBar({ session, closing, reopening, deleting, onGoLive, onClose, onReopen, onDelete, onExport, onManageMods, callerRole }: {
  session: Session;
  closing: boolean;
  reopening: boolean;
  deleting: boolean;
  onGoLive: () => void;
  onClose: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onExport: () => void;
  onManageMods: () => void;
  callerRole: CallerRole;
}) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [shared, setShared] = useState(false);

  const joinCode = session.join_code;
  const joinUrl  = typeof window !== 'undefined'
    ? `${window.location.origin}/s/${session.slug}`
    : '';
  const isOwner = ['host', 'org_owner', 'org_admin'].includes(callerRole);

  function copyCode() {
    navigator.clipboard.writeText(joinCode ?? '');
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  async function share() {
    if (navigator.share) {
      await navigator.share({ title: session.title, text: `Join "${session.title}" on GuestSpeak`, url: joinUrl }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(joinUrl);
      setShared(true); setTimeout(() => setShared(false), 2000);
    }
  }

  return (
    <div className="bg-brand-card border-b border-brand-purple/25">
      <div className="max-w-7xl mx-auto px-4 py-3">

        {/* Primary row — status action + join code */}
        <div className="flex items-center gap-3 flex-wrap">

          {/* Primary session action */}
          {session.status === 'upcoming' && (
            <button
              onClick={() => { if (confirm('Go live now?')) onGoLive(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Go live
            </button>
          )}
          {session.status === 'live' && (
            <button
              onClick={() => { if (confirm('Close this session? Submissions will stop.')) onClose(); }}
              disabled={closing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-sm hover:bg-red-500/20 transition-colors disabled:opacity-40"
            >
              {closing ? 'Closing…' : 'Close session'}
            </button>
          )}
          {session.status === 'closed' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-purple-200/40 uppercase tracking-wider">Session ended</span>
              <button onClick={onExport} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/50 hover:text-white transition-colors">
                <DownloadIcon /> Export CSV
              </button>
              <button onClick={onReopen} disabled={reopening} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40">
                {reopening ? 'Reopening…' : 'Reopen'}
              </button>
              <button onClick={onDelete} disabled={deleting} className="text-xs px-3 py-1.5 rounded-lg border border-red-700/40 text-red-400/70 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}

          {/* Join code — tappable to copy */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={copyCode}
              title="Tap to copy join code"
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border font-mono transition-colors ml-auto min-h-[44px] ${
                copied ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-white hover:border-brand-purple'
              }`}
            >
              <span className="text-purple-200/40 text-xs font-sans">Code</span>
              <span className="text-sm font-bold tracking-widest">{joinCode}</span>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}

          {/* QR toggle */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={() => setShowQR(v => !v)}
              title="Show QR code"
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showQR ? 'border-brand-purple text-brand-purple' : 'border-brand-border text-purple-200/40 hover:text-white hover:border-brand-border'}`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <path d="M14 14h.01M17 14h.01M14 17h.01M17 17h.01M20 14h.01M20 17h.01M20 20h.01" />
              </svg>
            </button>
          )}

          {/* Share */}
          {session.status !== 'closed' && (
            <button onClick={share} title="Share session link"
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${shared ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-purple-200/40 hover:text-white hover:border-brand-border'}`}>
              {shared ? <CheckIcon /> : <ShareIcon />}
            </button>
          )}
        </div>

        {/* Secondary row — owner-only admin actions */}
        {isOwner && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-brand-border/30 max-w-7xl">
            <Link href={`/s/${session.slug}/edit`} className="text-xs text-purple-200/40 hover:text-purple-200/70 transition-colors">Edit session</Link>
            <span className="text-brand-border">·</span>
            <button onClick={onManageMods} className="text-xs text-purple-200/40 hover:text-purple-200/70 transition-colors">Manage moderators</button>
          </div>
        )}
      </div>

      {/* QR panel */}
      {showQR && joinUrl && (
        <div className="border-t border-brand-border/30 py-4 flex flex-col items-center gap-2">
          <div className="bg-white rounded-2xl p-4 inline-block">
            <QRCode value={joinUrl} size={160} />
          </div>
          <p className="text-xs text-purple-200/40">Audience scans to join — no app needed</p>
        </div>
      )}
    </div>
  );
}

// ─── Credit display ───────────────────────────────────────────────────────────

function CreditDisplay({ credits, max, nextCreditSecs, creditCap }: {
  credits: number;
  max: number;
  nextCreditSecs?: number;
  creditCap?: number;
}) {
  const cap = creditCap ?? max;
  const showCountdown = nextCreditSecs !== undefined && credits < cap;
  const mins = Math.floor((nextCreditSecs ?? 0) / 60);
  const secs = String((nextCreditSecs ?? 0) % 60).padStart(2, '0');

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-purple-200/60">Credits</span>
      <div className="flex gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${i < credits ? 'bg-brand-orange' : 'bg-brand-border/60'}`} />
        ))}
      </div>
      <span className={`text-xs font-bold ${credits > 0 ? 'text-brand-amber' : 'text-purple-200/40'}`}>{credits}</span>
      {showCountdown && (
        <span className="text-xs text-purple-200/50 tabular-nums">+1 in {mins}:{secs}</span>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, isLiveSoon }: { status: string; isLiveSoon: boolean }) {
  if (status === 'live') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />Live
    </span>
  );
  if (isLiveSoon) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-pulse" />Live Soon
    </span>
  );
  if (status === 'closed') return (
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/50 text-xs font-semibold">Ended</span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-purple/20 text-brand-amber text-xs font-semibold">Upcoming</span>
  );
}

// ─── Sort tabs ────────────────────────────────────────────────────────────────

const SORT_TABS: { value: SortOption; label: string }[] = [
  { value: 'echoes',   label: '🔥 Top' },
  { value: 'recent',   label: '🕐 Recent' },
  { value: 'answered', label: '✓ Answered' },
  { value: 'starred',  label: '★ Starred' },
];

function SortTabs({ sort, onChange }: { sort: SortOption; onChange: (s: SortOption) => void }) {
  return (
    <div className="flex border-b border-brand-border/60 overflow-x-auto gap-0">
      {SORT_TABS.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all ${
            sort === tab.value
              ? 'border-brand-orange text-white'
              : 'border-transparent text-purple-200/40 hover:text-purple-200/70'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Featured top question card ───────────────────────────────────────────────

function FeaturedQuestionCard({ question, isEchoed, isMine, creditsLeft, onEcho,
  hostView, onStar, onAnswered, onHide, onPin, onSpotlight, onReply,
  onMute, onRemove, sessionClosed }: {
  question: Question & { is_pinned?: boolean; is_spotlighted?: boolean };
  isEchoed: boolean; isMine: boolean; creditsLeft: number;
  onEcho: () => void; hostView: boolean;
  onStar: () => void; onAnswered: () => void; onHide: () => void;
  onPin: () => void; onSpotlight: () => void; onReply: () => void;
  onMute?: () => void; onRemove?: () => void; sessionClosed: boolean;
}) {
  const canEcho = !isEchoed && !isMine && creditsLeft > 0 && question.status !== 'hidden';
  const isSpotlighted = !!question.is_spotlighted;

  return (
    <div className={`rounded-2xl border p-5 shadow-[0_0_30px_rgba(245,146,30,0.12)] ${
      isSpotlighted ? 'border-amber-400/60 bg-amber-500/5' : 'border-brand-orange/50 bg-brand-orange/5'
    }`}>
      {isSpotlighted && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-amber-300 tracking-wide">🎙 NOW ANSWERING</span>
        </div>
      )}
      {!isSpotlighted && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-brand-orange tracking-wide">🔥 TOP QUESTION</span>
        </div>
      )}

      <div className="flex gap-4 sm:gap-6">
        {/* Body */}
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg font-bold text-white leading-snug mb-3">{question.body}</p>
          <div className="flex items-center gap-2 flex-wrap">
            {question.status === 'answered' && (
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">✓ ANSWERED</span>
            )}
            {isMine && <span className="text-xs text-brand-orange/60 font-medium">Your question</span>}
            {question.author_username && (
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/40'}`}>
                {question.author_username}
              </span>
            )}
          </div>
          {question.host_reply && (
            <div className="mt-3 pl-3 border-l-2 border-brand-orange/40">
              <p className="text-xs text-brand-orange/70 font-semibold mb-1">Host reply</p>
              <p className="text-sm text-purple-200/80">{question.host_reply}</p>
            </div>
          )}
          {hostView && (
            <div className="mt-4 pt-3 border-t border-brand-border/30 space-y-2">
              <div className="flex items-center gap-2">
                <button onClick={onSpotlight} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${isSpotlighted ? 'bg-amber-500/20 border-amber-400/50 text-amber-300' : 'border-brand-border/60 text-purple-200/50 hover:border-amber-400/40 hover:text-amber-300'}`}>🎙 {isSpotlighted ? 'Now Answering' : 'Spotlight'}</button>
                <button onClick={onStar} className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'starred' ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400' : 'border-brand-border/60 text-purple-200/40 hover:text-yellow-400'}`}>★ Star</button>
                <button onClick={onAnswered} className={`text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'answered' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'border-brand-border/60 text-purple-200/40 hover:text-emerald-400'}`}>{question.status === 'answered' ? 'Answered' : '✓'}</button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={question.is_pinned ? 'Unpin' : 'Pin'} active={!!question.is_pinned}>{question.is_pinned ? 'Unpin' : 'Pin'}</ModButton>
                <ModButton onClick={onHide} title="Hide" danger={question.status !== 'hidden'} active={question.status === 'hidden'}>{question.status === 'hidden' ? 'Unhide' : 'Hide'}</ModButton>
                <ModButton onClick={onReply} title="Reply">Reply</ModButton>
                {onMute && <ModButton onClick={onMute} title="Mute" active={!!question.author_is_muted} danger={!question.author_is_muted}>{question.author_is_muted ? 'Unmute' : 'Mute'}</ModButton>}
                {onRemove && <ModButton onClick={() => { if (confirm('Remove?')) onRemove!(); }} title="Remove" danger>Remove</ModButton>}
              </div>
            </div>
          )}
        </div>

        {/* Echo button */}
        <div className="shrink-0 flex flex-col items-center gap-2 min-w-[68px]">
          <button
            onClick={onEcho}
            disabled={!canEcho}
            className={`w-full flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition-all active:scale-95 ${
              isEchoed
                ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                : canEcho
                ? 'border-brand-border text-purple-200/50 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/20 cursor-not-allowed'
            }`}
          >
            <span className="text-xl font-black leading-none">↑</span>
            <span className="text-2xl font-black leading-none">{question.vote_count}</span>
            <span className="text-[10px] font-semibold tracking-wide opacity-60">echoes</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

function QuestionCard({ question, isEchoed, isMine, creditsLeft, onEcho,
  hostView, onStar, onAnswered, onHide, onPin, onSpotlight, onReply,
  onMute, onRemove, sessionClosed }: {
  question: Question & { is_pinned?: boolean; is_spotlighted?: boolean };
  isEchoed: boolean;
  isMine: boolean;
  creditsLeft: number;
  onEcho: () => void;
  hostView: boolean;
  onStar: () => void;
  onAnswered: () => void;
  onHide: () => void;
  onPin: () => void;
  onSpotlight: () => void;
  onReply: () => void;
  onMute?: () => void;
  onRemove?: () => void;
  sessionClosed: boolean;
}) {
  const canEcho = !isEchoed && !isMine && creditsLeft > 0 && question.status !== 'hidden';
  const isSpotlighted = !!question.is_spotlighted;
  const isPinned = !!question.is_pinned;

  return (
    <div className={`card overflow-hidden flex flex-col transition-colors ${
      isSpotlighted              ? 'border-amber-400/60 bg-amber-500/5' :
      isPinned                   ? 'border-brand-orange/50 bg-brand-orange/5' :
      question.status === 'starred'  ? 'border-yellow-500/40 bg-yellow-500/5' :
      question.status === 'answered' ? 'border-emerald-500/30 bg-emerald-500/5' :
      question.status === 'hidden'   ? 'border-brand-border/30 opacity-50' : ''
    }`}>
      {/* Now Answering banner */}
      {isSpotlighted && (
        <div className="bg-amber-500/15 border-b border-amber-400/25 px-4 py-2 flex items-center gap-2">
          <span className="text-amber-300 font-bold text-xs tracking-widest uppercase">🎙 Now Answering</span>
        </div>
      )}

      <div className="p-4 flex gap-3 items-start">
        {/* Body + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm leading-relaxed break-words">{question.body}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isPinned && <span className="text-xs text-brand-orange font-semibold">📌 Pinned</span>}
            {isMine && <span className="text-xs text-brand-orange/60 font-medium">Your question</span>}
            {question.status === 'starred'  && <span className="text-xs text-yellow-400 font-semibold">★ Starred</span>}
            {question.status === 'answered' && <span className="text-xs text-emerald-400 font-semibold">✓ Answered</span>}
            {question.author_username && (
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/30'}`}>
                {question.author_username}
              </span>
            )}
          </div>

          {/* Host reply */}
          {question.host_reply && (
            <div className="mt-3 pl-3 border-l-2 border-brand-orange/40">
              <p className="text-xs text-brand-orange/70 font-semibold mb-1">Host reply</p>
              <p className="text-sm text-purple-200/80">{question.host_reply}</p>
            </div>
          )}

          {/* Mod action buttons */}
          {hostView && (
            <div className="mt-3 pt-3 border-t border-brand-border/30 space-y-2">
              {/* Primary actions row */}
              <div className="flex items-center gap-2">
                {/* Spotlight — hero action */}
                <button
                  onClick={onSpotlight}
                  title={isSpotlighted ? 'Remove from spotlight' : 'Spotlight — mark as Now Answering'}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    isSpotlighted
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                      : 'border-brand-border/60 text-purple-200/50 hover:border-amber-400/40 hover:text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  🎙 {isSpotlighted ? 'Now Answering' : 'Spotlight'}
                </button>

                {/* Star */}
                <button
                  onClick={onStar}
                  title={question.status === 'starred' ? 'Remove star' : 'Star this question'}
                  className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    question.status === 'starred'
                      ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                      : 'border-brand-border/60 text-purple-200/40 hover:text-yellow-400 hover:border-yellow-500/30'
                  }`}
                >
                  ★ Star
                </button>

                {/* Answered */}
                <button
                  onClick={onAnswered}
                  title={question.status === 'answered' ? 'Mark unanswered' : 'Mark answered'}
                  className={`text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    question.status === 'answered'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'border-brand-border/60 text-purple-200/40 hover:text-emerald-400 hover:border-emerald-500/30'
                  }`}
                >
                  {question.status === 'answered' ? 'Answered' : '✓'}
                </button>
              </div>

              {/* Secondary actions row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={isPinned ? 'Unpin' : 'Pin to top'} active={isPinned}>
                  {isPinned ? 'Unpin' : 'Pin'}
                </ModButton>
                <ModButton onClick={onHide} title={question.status === 'hidden' ? 'Unhide' : 'Hide'} danger={question.status !== 'hidden'} active={question.status === 'hidden'}>
                  {question.status === 'hidden' ? 'Unhide' : 'Hide'}
                </ModButton>
                <ModButton onClick={onReply} title="Add host reply">Reply</ModButton>
                {onMute && (
                  <ModButton onClick={onMute} title={question.author_is_muted ? 'Unmute' : 'Mute'} active={!!question.author_is_muted} danger={!question.author_is_muted}>
                    {question.author_is_muted ? 'Unmute' : 'Mute'}
                  </ModButton>
                )}
                {onRemove && (
                  <ModButton onClick={() => { if (confirm('Remove this person from the session?')) onRemove!(); }} title="Remove from session" danger>Remove</ModButton>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Echo button — right side, matches FeaturedQuestionCard */}
        <div className="shrink-0 flex flex-col items-center min-w-[56px]">
          <button
            onClick={onEcho}
            disabled={!canEcho}
            title={isMine ? "Can't Echo your own question" : isEchoed ? 'Already Echoed' : 'Add Echo'}
            className={`w-full flex flex-col items-center gap-1 px-2 py-3 rounded-xl border transition-all active:scale-95 ${
              isEchoed
                ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                : canEcho
                ? 'border-brand-border text-purple-200/50 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/20 cursor-not-allowed'
            }`}
          >
            <span className="text-base font-black leading-none">↑</span>
            <span className="text-xl font-black leading-none">{question.vote_count}</span>
            <span className="text-[10px] font-semibold tracking-wide opacity-60">echoes</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ModButton({ children, active, danger, onClick, title }: {
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`text-xs px-3 py-2.5 rounded-lg border transition-colors font-semibold min-h-[44px] ${
        active  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' :
        danger  ? 'border-red-700/40 text-red-400 hover:bg-red-900/20' :
                  'border-brand-border/60 text-purple-200/50 hover:border-brand-purple hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Reply modal ──────────────────────────────────────────────────────────────

function ReplyModal({ question, reply, loading, onChange, onSubmit, onClose }: {
  question: Question;
  reply: string;
  loading: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0">
      <div className="card p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white">Host reply</h2>
          <button onClick={onClose} className="text-purple-200/40 hover:text-white transition-colors p-1" aria-label="Close">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p className="text-purple-200/50 text-sm mb-4 line-clamp-2">{question.body}</p>
        <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>
          <textarea
            value={reply}
            onChange={e => onChange(e.target.value)}
            placeholder="Write your reply…"
            rows={3}
            maxLength={2000}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-base
                       placeholder-purple-200/40 resize-none focus:outline-none focus:border-brand-purple transition-colors mb-4"
          />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="btn-ghost text-sm py-2.5 px-4">Cancel</button>
            <button type="submit" disabled={loading || !reply.trim()} className="btn-primary text-sm py-2.5 px-5 disabled:opacity-40">
              {loading ? 'Saving…' : 'Save reply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Submit bar ───────────────────────────────────────────────────────────────

function SubmitBar({ body, setBody, credits, submitting, similarQuestions, onSubmit, onEchoSimilar, sessionStatus, isRegistered, postAnonymously, onToggleAnon, isMod }: {
  body: string; setBody: (v: string) => void;
  credits: number; submitting: boolean;
  similarQuestions: Question[];
  onSubmit: () => void; onEchoSimilar: (id: string) => void;
  sessionStatus: string;
  isRegistered: boolean;
  postAnonymously: boolean;
  onToggleAnon: () => void;
  isMod?: boolean;
}) {
  const MAX = 300;
  const remaining = MAX - body.length;
  const canSubmit = body.trim().length > 0 && (isMod || credits > 0) && !submitting && sessionStatus !== 'closed';

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-card border-t border-brand-border shadow-2xl pb-[env(safe-area-inset-bottom)]">
      {similarQuestions.length > 0 && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <p className="text-xs text-brand-orange font-semibold mb-2">Similar questions already asked:</p>
          <div className="space-y-2 mb-3">
            {similarQuestions.slice(0, 3).map(q => (
              <div key={q.id} className="flex items-center gap-3 bg-brand-card rounded-xl px-3 py-2 border border-brand-border/50">
                <p className="flex-1 text-xs text-purple-200/70 leading-snug">{q.body}</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-brand-amber font-bold">{q.vote_count} Echoes</span>
                  <button
                    onClick={() => onEchoSimilar(q.id)}
                    className="text-xs bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-1 rounded-lg font-semibold hover:bg-brand-orange/30 transition-colors"
                  >
                    Echo
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 flex gap-2 sm:gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            placeholder={isMod || credits > 0 ? 'Ask a question…' : 'No credits remaining'}
            disabled={!isMod && credits < 1}
            maxLength={300}
            rows={2}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 pr-12
                       text-white text-base placeholder-purple-200/40 resize-none
                       focus:outline-none focus:border-brand-purple transition-colors disabled:opacity-40"
          />
          <span className={`absolute right-3 bottom-3 text-xs ${remaining < 50 ? 'text-red-400' : 'text-purple-200/40'}`}>
            {remaining} left
          </span>
        </div>
        <div className="flex flex-col items-end gap-2 self-end">
          {/* Anonymous toggle — registered users only */}
          {isRegistered && (
            <button
              type="button"
              onClick={onToggleAnon}
              title={postAnonymously ? 'Posting anonymously — tap to post as yourself' : 'Post anonymously'}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                postAnonymously
                  ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                  : 'bg-white/5 border-white/10 text-purple-200/40 hover:text-purple-200/70'
              }`}
            >
              {/* Mask icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" />
                <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" />
              </svg>
              {postAnonymously ? 'Anon on' : 'Anon off'}
            </button>
          )}
          <button onClick={onSubmit} disabled={!canSubmit} className="btn-primary px-4 py-3 disabled:opacity-40 disabled:cursor-not-allowed">
            {submitting ? '…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Utility screens ──────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-purple-200/50 text-sm">Joining session…</p>
      </div>
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center px-4">
      <div className="text-center card p-8 max-w-sm">
        <p className="text-4xl mb-3">🔍</p>
        <h2 className="text-white font-bold text-lg mb-2">Session not found</h2>
        <p className="text-purple-200/50 text-sm mb-6">{message}</p>
        <Link href="/" className="btn-primary">Back to GuestSpeak</Link>
      </div>
    </div>
  );
}

// ─── Welcome screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ session, onEnter }: {
  session: Session & { org_avatar_url?: string };
  onEnter: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-brand-bg px-4 py-8 overflow-y-auto">
      <div className="card p-8 w-full max-w-sm text-center my-auto">
        {/* Channel avatar */}
        {(session as any).org_avatar_url ? (
          <img
            src={(session as any).org_avatar_url}
            alt=""
            className="w-16 h-16 rounded-full mx-auto mb-4 object-cover ring-2 ring-brand-border"
          />
        ) : session.org_name ? (
          <div className="w-16 h-16 rounded-full mx-auto mb-4 bg-brand-purple/50 border border-brand-border flex items-center justify-center">
            <span className="text-white font-bold text-2xl">{session.org_name[0].toUpperCase()}</span>
          </div>
        ) : (
          <div className="w-16 h-16 rounded-full mx-auto mb-4 bg-brand-orange/20 border border-brand-orange/30 flex items-center justify-center">
            <span className="text-brand-orange font-bold text-2xl">Q</span>
          </div>
        )}

        {session.org_name && (
          <p className="text-brand-orange/70 text-xs font-semibold uppercase tracking-widest mb-2">{session.org_name}</p>
        )}

        <h1 className="text-white font-bold text-xl leading-snug mb-3">{session.title}</h1>

        {session.description && (
          <p className="text-purple-200/50 text-sm leading-relaxed mb-6">{session.description}</p>
        )}

        <div className="flex items-center justify-center gap-2 mb-8">
          <StatusBadge status={session.status} isLiveSoon={false} />
          {session.host_username && (
            <span className="text-xs text-purple-200/40">· hosted by {session.host_username}</span>
          )}
        </div>

        <button onClick={onEnter} className="btn-primary w-full py-3 text-sm font-bold">
          Enter Q&amp;A
        </button>

        <p className="text-xs text-purple-200/20 mt-5">Powered by GuestSpeak</p>
      </div>
    </div>
  );
}

// ─── Stream embed ─────────────────────────────────────────────────────────────

type StreamInfo =
  | { type: 'youtube'; embedUrl: string; watchUrl: string }
  | { type: 'twitch';  embedUrl: string; watchUrl: string }
  | { type: 'link';    watchUrl: string };

function parseStream(url: string): StreamInfo | null {
  if (!url) return null;

  // YouTube: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/live/ID
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?.*?v=|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (ytMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`,
      watchUrl: url,
    };
  }

  // Twitch video: twitch.tv/videos/ID
  const twitchVideo = url.match(/twitch\.tv\/videos\/(\d+)/);
  if (twitchVideo) {
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'guestspeak.app';
    return {
      type: 'twitch',
      embedUrl: `https://player.twitch.tv/?video=${twitchVideo[1]}&parent=${parent}&autoplay=false`,
      watchUrl: url,
    };
  }

  // Twitch channel: twitch.tv/CHANNEL (must not be twitch.tv/videos/…)
  const twitchChannel = url.match(/twitch\.tv\/([A-Za-z0-9_]+)(?:[/?#]|$)/);
  if (twitchChannel && twitchChannel[1] !== 'videos') {
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'guestspeak.app';
    return {
      type: 'twitch',
      embedUrl: `https://player.twitch.tv/?channel=${twitchChannel[1]}&parent=${parent}&autoplay=false`,
      watchUrl: url,
    };
  }

  // Anything else — link fallback
  return { type: 'link', watchUrl: url };
}

function StreamEmbed({ url, sessionSlug }: { url: string; sessionSlug: string }) {
  const info = parseStream(url);
  if (!info) return null;

  // Persist hide preference per session in localStorage
  const storageKey = `gs_hide_stream_${sessionSlug}`;
  const [hidden, setHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });

  function toggle() {
    const next = !hidden;
    setHidden(next);
    localStorage.setItem(storageKey, next ? '1' : '0');
  }

  if (info.type === 'link') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-brand-card border border-brand-border rounded-xl px-4 py-3">
        <svg className="w-5 h-5 text-brand-orange flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-sm text-purple-200/60 flex-1">This session is streaming live</span>
        <a
          href={info.watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-brand-orange hover:text-brand-amber transition-colors flex-shrink-0"
        >
          Watch live →
        </a>
      </div>
    );
  }

  return (
    <div className="mb-4">
      {/* Header row — label + hide toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-brand-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
          </svg>
          <span className="text-xs font-semibold text-purple-200/50 uppercase tracking-wider">
            {info.type === 'youtube' ? 'YouTube Live' : 'Twitch Stream'}
          </span>
        </div>
        <button
          onClick={toggle}
          className="text-xs text-purple-200/40 hover:text-purple-200/70 transition-colors flex items-center gap-1"
        >
          {hidden ? (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Show video
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              Hide video
            </>
          )}
        </button>
      </div>

      {/* Embed — 16:9 aspect ratio */}
      {!hidden && (
        <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={info.embedUrl}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            title="Live stream"
          />
        </div>
      )}

      {/* When hidden — compact pill so they can still find the stream */}
      {hidden && (
        <div className="flex items-center justify-between bg-brand-card border border-brand-border/50 rounded-xl px-4 py-2.5">
          <span className="text-sm text-purple-200/40">Stream hidden</span>
          <a
            href={info.watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-brand-orange hover:text-brand-amber transition-colors"
          >
            Open in {info.type === 'youtube' ? 'YouTube' : 'Twitch'} →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function EchoArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 26 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M 8,4  Q 13,-4 18,4"  />
      <path d="M 4,15 Q 13,5  22,15" />
      <path d="M 0,26 Q 13,14 26,26" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
