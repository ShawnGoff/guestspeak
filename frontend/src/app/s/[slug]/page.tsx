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

export default function SessionPage({ params }: SessionPageProps) {
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
  const [replyTarget, setReplyTarget]       = useState<Question | null>(null);
  const [replyText, setReplyText]           = useState('');
  const [replyLoading, setReplyLoading]     = useState(false);
  const [closingSession, setClosingSession] = useState(false);
  const [reopeningSession, setReopeningSession] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);

  const [showUsernamePicker, setShowUsernamePicker] = useState(false);

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

        // Determine how to join based on who's viewing
        const isRegistered   = !!localStorage.getItem('aa_user');
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
      setQuestions(prev => [q, ...prev]);
      // Show "↑ N new" badge if user is scrolled down
      if (!atTopRef.current) setNewQuestionsCount(n => n + 1);
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
    if (!session || !body.trim() || credits < 1) return;
    setSubmitting(true); setError(null);
    try {
      const q = await api.post<Question>('/questions', { session_id: session.id, body: body.trim() });
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

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      <SessionHeader
        session={session}
        isLiveSoon={!!isLiveSoon}
        credits={credits}
        isMod={isMod}
        hostView={hostView}
        participantCount={participantCount}
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

      <main className="flex-1 max-w-2xl w-full mx-auto px-3 sm:px-4 pb-32 pt-4">

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
                       text-white text-sm placeholder-purple-200/40 focus:outline-none focus:border-brand-purple transition-colors"
          />
        </div>

        <SortTabs sort={sort} onChange={setSort} />

        <div className="space-y-3 mt-4">
          {displayedQuestions.length === 0 && (
            <div className="text-center py-16 text-purple-200/40">
              <p className="text-4xl mb-3">❓</p>
              <p className="font-medium">No questions yet.</p>
              <p className="text-sm mt-1">Be the first to ask something.</p>
            </div>
          )}
          {displayedQuestions.map(q => (
            <QuestionCard
              key={q.id}
              question={q}
              isEchoed={echoedIds.has(q.id)}
              isMine={myQuestionIds.has(q.id)}
              creditsLeft={credits}
              onEcho={() => addEcho(q.id)}
              // Mod props
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
        />
      )}

      {submissionClosed && session.status !== 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border p-4 text-center text-sm text-purple-200/60">
          Question submission has closed for this session.
        </div>
      )}

      {session.status === 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border p-4 text-center text-sm text-purple-200/60">
          This session has ended. Questions are archived below.
        </div>
      )}

      {error && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-red-900/80 text-red-300 text-sm px-4 py-2 rounded-xl border border-red-700 z-50">
          {error}
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
                     bg-brand-purple text-white text-xs font-bold
                     px-4 py-2 rounded-full shadow-xl border border-brand-purple/60
                     hover:bg-brand-purple/90 transition-colors flex items-center gap-1.5"
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

function SessionHeader({ session, isLiveSoon, credits, isMod, hostView, participantCount, onToggleHostView }: {
  session: Session;
  isLiveSoon: boolean;
  credits: number;
  isMod: boolean;
  hostView: boolean;
  participantCount: number | null;
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
          <CreditDisplay credits={credits} max={session.credits_per_user} />
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
  const [copied, setCopied]       = useState(false);
  const [showQR, setShowQR]       = useState(false);
  const [shared, setShared]       = useState(false);

  const joinCode = session.join_code;
  const joinUrl  = typeof window !== 'undefined'
    ? `${window.location.origin}/s/${session.slug}`
    : '';

  function copyCode() {
    navigator.clipboard.writeText(joinCode ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-brand-purple/10 border-b border-brand-purple/30">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-brand-orange font-bold uppercase tracking-widest mr-auto">Host controls</span>

        {/* Edit + Manage mods — only host/org_owner/org_admin */}
        {['host', 'org_owner', 'org_admin'].includes(callerRole) && (
          <>
            <Link
              href={`/s/${session.slug}/edit`}
              className="text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/60 hover:border-brand-purple hover:text-white transition-colors"
            >
              Edit
            </Link>
            <button
              onClick={onManageMods}
              className="text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/60 hover:border-brand-purple hover:text-white transition-colors"
            >
              Manage mods
            </button>
          </>
        )}

        {/* Share */}
        {session.status !== 'closed' && (
          <button
            onClick={async () => {
              const url = joinUrl;
              const text = `Join "${session.title}" on GuestSpeak`;
              if (navigator.share) {
                await navigator.share({ title: session.title, text, url }).catch(() => {});
              } else {
                await navigator.clipboard.writeText(url);
                setShared(true);
                setTimeout(() => setShared(false), 2000);
              }
            }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              shared ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-purple-200/60 hover:border-brand-purple hover:text-white'
            }`}
          >
            {shared ? <CheckIcon /> : <ShareIcon />}
            {shared ? 'Copied!' : 'Share'}
          </button>
        )}

        {/* QR code toggle */}
        {joinCode && session.status !== 'closed' && (
          <button
            onClick={() => setShowQR(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              showQR ? 'border-brand-purple text-brand-purple bg-brand-purple/10' : 'border-brand-border text-purple-200/60 hover:border-brand-purple hover:text-white'
            }`}
          >
            QR code
          </button>
        )}

        {/* Join code copy */}
        {joinCode && (
          <button
            onClick={copyCode}
            className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
              copied ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-white hover:border-brand-purple'
            }`}
          >
            <span className="text-purple-200/40">Code:</span>
            {joinCode}
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        )}

        {/* Go Live */}
        {session.status === 'upcoming' && (
          <button
            onClick={() => {
              if (confirm('Go live now? Your audience will be notified the session has started.')) onGoLive();
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-600/60 text-emerald-400 hover:bg-emerald-900/20 transition-colors flex items-center gap-1.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Go live
          </button>
        )}

        {/* Close session */}
        {session.status === 'live' && (
          <button
            onClick={() => {
              if (confirm('Close this session? Submissions will stop and it becomes read-only.')) onClose();
            }}
            disabled={closing}
            className="text-xs px-3 py-1.5 rounded-lg border border-red-700/50 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            {closing ? 'Closing…' : 'Close session'}
          </button>
        )}

        {session.status === 'closed' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-purple-200/40 mr-1">Session ended</span>
            <button
              onClick={onExport}
              className="text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/60 hover:border-brand-purple hover:text-white transition-colors flex items-center gap-1.5"
            >
              <DownloadIcon />
              Export CSV
            </button>
            <button
              onClick={onReopen}
              disabled={reopening}
              className="text-xs px-3 py-1.5 rounded-lg border border-emerald-600/60 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40"
            >
              {reopening ? 'Reopening…' : 'Reopen'}
            </button>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="text-xs px-3 py-1.5 rounded-lg border border-red-700/50 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        )}
      </div>

      {/* QR panel */}
      {showQR && joinUrl && (
        <div className="max-w-2xl mx-auto px-4 pb-4 flex flex-col items-center gap-3">
          <div className="bg-white rounded-2xl p-4 inline-block">
            <QRCode value={joinUrl} size={180} />
          </div>
          <p className="text-xs text-purple-200/40">Audience scans to join — no code needed</p>
        </div>
      )}
    </div>
  );
}

// ─── Credit display ───────────────────────────────────────────────────────────

function CreditDisplay({ credits, max }: { credits: number; max: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-purple-200/50">Credits</span>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${i < credits ? 'bg-brand-orange' : 'bg-brand-border'}`} />
        ))}
      </div>
      <span className={`text-xs font-bold ${credits > 0 ? 'text-brand-amber' : 'text-brand-border'}`}>{credits}</span>
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

const SORT_TABS: { value: SortOption; label: string; short: string }[] = [
  { value: 'echoes',   label: 'Top Echoes', short: 'Top' },
  { value: 'recent',   label: 'Recent',     short: 'New' },
  { value: 'answered', label: 'Answered',   short: 'Done' },
  { value: 'starred',  label: 'Starred',    short: '★' },
];

function SortTabs({ sort, onChange }: { sort: SortOption; onChange: (s: SortOption) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-brand-card rounded-xl border border-brand-border">
      {SORT_TABS.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            sort === tab.value ? 'bg-brand-purple text-white' : 'text-purple-200/50 hover:text-white'
          }`}
        >
          <span className="hidden sm:inline">{tab.label}</span>
          <span className="sm:hidden">{tab.short}</span>
        </button>
      ))}
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

      <div className="p-4 flex gap-3">
        {/* Echo button + count */}
        <div className="flex flex-col items-center gap-1 min-w-[44px]">
          <button
            onClick={onEcho}
            disabled={!canEcho}
            title={isMine ? "Can't Echo your own question" : isEchoed ? 'Already Echoed' : 'Add Echo'}
            className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
              isEchoed        ? 'bg-brand-orange/20 border-brand-orange text-brand-orange' :
              canEcho         ? 'bg-transparent border-white/40 text-white hover:border-brand-orange hover:text-brand-orange hover:bg-brand-orange/10' :
                                'bg-transparent border-brand-border/30 text-purple-200/20 cursor-not-allowed'
            }`}
          >
            <EchoArrow />
          </button>
          <span className={`text-sm font-bold ${question.vote_count > 0 ? 'text-brand-amber' : 'text-purple-200/40'}`}>
            {question.vote_count}
          </span>
        </div>

        {/* Body + meta */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm leading-relaxed">{question.body}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isPinned && <span className="text-xs text-brand-orange font-semibold">📌 Pinned</span>}
            {isMine && <span className="text-xs text-brand-orange/60 font-medium">Your question</span>}
            {question.status === 'starred'  && <span className="text-xs text-yellow-400 font-semibold">★ Starred</span>}
            {question.status === 'answered' && <span className="text-xs text-emerald-400 font-semibold">✓ Answered</span>}
            {question.author_username && (
              <span className="text-xs text-purple-200/30">{question.author_username}</span>
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
            <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-brand-border/30 flex-wrap">
              <ModButton
                active={question.status === 'starred'}
                onClick={onStar}
                title={question.status === 'starred' ? 'Unstar' : 'Star'}
              >
                ★
              </ModButton>
              <ModButton
                active={question.status === 'answered'}
                onClick={onAnswered}
                title={question.status === 'answered' ? 'Mark unanswered' : 'Mark answered'}
              >
                ✓
              </ModButton>
              <ModButton onClick={onHide} title={question.status === 'hidden' ? 'Unhide question' : 'Hide question'} danger={question.status !== 'hidden'} active={question.status === 'hidden'}>
                {question.status === 'hidden' ? 'Unhide' : 'Hide'}
              </ModButton>
              <ModButton onClick={onPin} title={isPinned ? 'Unpin question' : 'Pin to top'} active={isPinned}>
                {isPinned ? 'Unpin' : '📌 Pin'}
              </ModButton>
              <ModButton onClick={onSpotlight} title={isSpotlighted ? 'Remove spotlight' : 'Now Answering'} active={isSpotlighted}>
                {isSpotlighted ? '🎙 Live' : '🎙 Now'}
              </ModButton>
              <ModButton onClick={onReply} title="Add host reply">
                Reply
              </ModButton>
              {onMute && (
                <ModButton
                  onClick={onMute}
                  title={question.author_is_muted ? 'Unmute — allow them to ask again' : 'Mute — prevent further questions'}
                  active={!!question.author_is_muted}
                  danger={!question.author_is_muted}
                >
                  {question.author_is_muted ? 'Unmute' : '🔇 Mute'}
                </ModButton>
              )}
              {onRemove && (
                <ModButton onClick={onRemove} title="Remove from session" danger>
                  Remove
                </ModButton>
              )}
            </div>
          )}
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
      className={`text-xs px-2.5 py-1 rounded-lg border transition-colors font-semibold ${
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="card p-6 w-full max-w-lg">
        <h2 className="font-bold text-white mb-2">Host reply</h2>
        <p className="text-purple-200/50 text-sm mb-4 line-clamp-2">{question.body}</p>
        <textarea
          value={reply}
          onChange={e => onChange(e.target.value)}
          placeholder="Write your reply…"
          rows={4}
          maxLength={2000}
          className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-sm
                     placeholder-brand-border resize-none focus:outline-none focus:border-brand-purple transition-colors mb-4"
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="btn-ghost text-sm py-2 px-4">Cancel</button>
          <button onClick={onSubmit} disabled={loading || !reply.trim()} className="btn-primary text-sm py-2 px-5 disabled:opacity-40">
            {loading ? 'Saving…' : 'Save reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Submit bar ───────────────────────────────────────────────────────────────

function SubmitBar({ body, setBody, credits, submitting, similarQuestions, onSubmit, onEchoSimilar, sessionStatus }: {
  body: string; setBody: (v: string) => void;
  credits: number; submitting: boolean;
  similarQuestions: Question[];
  onSubmit: () => void; onEchoSimilar: (id: string) => void;
  sessionStatus: string;
}) {
  const MAX = 300;
  const remaining = MAX - body.length;
  const canSubmit = body.trim().length > 0 && credits > 0 && !submitting && sessionStatus !== 'closed';

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-card border-t border-brand-border shadow-2xl">
      {similarQuestions.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 pt-3">
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

      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 flex gap-2 sm:gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            placeholder={credits > 0 ? 'Ask a question…' : 'No credits remaining'}
            disabled={credits < 1}
            maxLength={300}
            rows={2}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 pr-12
                       text-white text-sm placeholder-purple-200/40 resize-none
                       focus:outline-none focus:border-brand-purple transition-colors disabled:opacity-40"
          />
          <span className={`absolute right-3 bottom-3 text-xs ${remaining < 50 ? 'text-red-400' : 'text-purple-200/40'}`}>
            {remaining} left
          </span>
        </div>
        <button onClick={onSubmit} disabled={!canSubmit} className="btn-primary px-4 py-3 self-end disabled:opacity-40 disabled:cursor-not-allowed">
          {submitting ? '…' : 'Ask'}
        </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-bg px-4">
      <div className="card p-8 w-full max-w-sm text-center">
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
