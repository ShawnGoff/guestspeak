'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, sseUrl } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
import ModeratorPanel from '@/components/ModeratorPanel';
import GuestUsernameModal from '@/components/GuestUsernameModal';
import QRCode from 'react-qr-code';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionPageProps {
  params: { slug: string };
}

type SortOption = 'echoes' | 'recent' | 'answered' | 'starred' | 'hidden';

/** Seconds between credit regen ticks — mirrors CREDIT_REGEN_MINUTES on the server. */
const REGEN_SECS = 10 * 60;

/** Consecutive SSE failures before giving up and polling instead. */
const SSE_MAX_CONSECUTIVE_FAILURES = 3;

/** Poll session-level state (status, headcount) every Nth feed tick. */
const SESSION_REFRESH_EVERY_TICKS = 4;

/**
 * Floor on how often the credit heartbeat may be sent. A backstop, not the
 * schedule: the countdown drives normal timing, but no server response or
 * render pattern should ever be able to turn this into a request storm.
 */
const MIN_HEARTBEAT_INTERVAL_MS = 5_000;

/** Roles that run the session rather than participate in it — no credits, no regen. */
const ELEVATED_ROLES: readonly string[] = ['host', 'org_owner', 'org_admin', 'moderator'];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SessionPageClient({ params }: SessionPageProps) {
  const router = useRouter();
  const [session, setSession]               = useState<Session & { caller_role?: CallerRole; mod_permissions?: Record<string, boolean> } | null>(null);
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
  const [anonCredits, setAnonCredits]               = useState(2);

  // Credit regen countdown (seconds until next credit)
  // CREDIT_CAP: dot display — always the host's setting.
  // REGEN_CAP:  the ceiling the heartbeat will regen to.
  //             Guests cap at 2 (sign-up incentive); registered users cap at 6.
  const CREDIT_CAP  = session?.credits_per_user ?? 3;
  const REGEN_CAP   = isRegistered ? 6 : 2;
  // Narrowed out of `session` so effects can depend on the id alone rather than
  // re-running every time any other session field changes.
  const sessionId     = session?.id;
  const sessionStatus = session?.status;
  const callerRole    = session?.caller_role ?? 'none';
  const [nextCreditSecs, setNextCreditSecs] = useState(REGEN_SECS);
  const [regenExhausted, setRegenExhausted] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);

  const [showSignupPrompt, setShowSignupPrompt]   = useState(false);
  const [showReport, setShowReport]               = useState(false);
  const [reportDone, setReportDone]               = useState(false);
  const [burstCooldown, setBurstCooldown]         = useState(0); // seconds remaining in burst cooldown
  const burstTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Live UX
  const [showWelcome, setShowWelcome]             = useState(false);
  const [participantCount, setParticipantCount]   = useState<number | null>(null);
  const [newQuestionsCount, setNewQuestionsCount] = useState(0);
  const atTopRef = useRef(true);

  const similarTimer = useRef<ReturnType<typeof setTimeout>>();
  const sseRef = useRef<EventSource | null>(null);

  // The SSE effect must not re-run when `sort` changes — that would drop and
  // rebuild the live connection every time the user flips the sort tabs. A ref
  // keeps the reconnect refetch reading the *current* sort instead of the value
  // captured when the stream was opened.
  // The server decides how to follow the feed, but the client can downgrade
  // itself to polling if the stream refuses it (see the SSE error handler).
  // Bumped on every successful join. The initial credit sync waits on this:
  // a guest picks their display name after the page has already mounted, so
  // syncing only on mount would skip them entirely.
  const [joinCount, setJoinCount] = useState(0);
  const [feedModeOverride, setFeedModeOverride] = useState<'polling' | null>(null);
  const feedMode = feedModeOverride ?? session?.feed_mode ?? 'live';

  const sortRef = useRef(sort);
  useEffect(() => { sortRef.current = sort; }, [sort]);

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
            const joined = await api.post<{ credits_remaining: number; anon_credits: number }>(`/sessions/${s.id}/join`, {});
            setCredits(joined.credits_remaining);
            setAnonCredits(joined.anon_credits ?? 2);
            setJoinCount(n => n + 1);
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
            const joined = await api.post<{ credits_remaining: number; anon_credits: number }>(`/sessions/${s.id}/join`, {
              guest_username: savedGuestName,
            });
            setCredits(joined.credits_remaining);
            setAnonCredits(joined.anon_credits ?? 2);
            setJoinCount(n => n + 1);
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

        const result = await api.get<{ data: Question[] }>(`/questions?sessionId=${s.id}&sort=${sortRef.current}`);
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

    // Very large sessions do not get a live stream — per-event fan-out does not
    // survive a stadium. The audience polls the cached feed instead; hosts and
    // mods are always sent feed_mode 'live'.
    if (feedMode === 'polling') {
      const intervalMs = session.poll_interval_ms ?? 5000;
      let cancelled = false;
      let ticks = 0;

      const tick = async () => {
        try {
          const r = await api.get<{ data: Question[] }>(
            `/questions?sessionId=${sessionId}&sort=${sortRef.current}`,
          );
          if (!cancelled) setQuestions(r.data);
        } catch {
          // Transient failure — the next tick retries.
        }

        // Session-level state (status, participant count) is not part of the
        // question feed and used to arrive over SSE. Without this, a polling
        // audience never learns the host closed the session — they keep
        // submitting into a 410. Refreshed on a slower cadence than the feed so
        // it does not double every poller's request rate.
        ticks += 1;
        if (ticks % SESSION_REFRESH_EVERY_TICKS === 0) {
          try {
            const s = await api.get<Session & { participant_count?: number }>(
              `/sessions/${params.slug}`,
            );
            if (!cancelled) {
              setSession(prev => prev
                ? { ...prev, status: s.status, feed_mode: s.feed_mode }
                : prev);
              if (s.participant_count != null) setParticipantCount(s.participant_count);
            }
          } catch {
            // Ignore — the next refresh retries.
          }
        }
      };

      const poll = setInterval(tick, intervalMs);
      return () => { cancelled = true; clearInterval(poll); };
    }

    let reconnecting = false;
    let failures = 0;

    const es = new EventSource(sseUrl(sessionId));
    sseRef.current = es;

    // EventSource reconnects on its own and does not expose the HTTP status, so
    // a session that has grown past the live-feed threshold answers 409 forever
    // and the browser would retry that in a tight loop — thousands of clients
    // hammering an endpoint that will never accept them. Give up after a few
    // consecutive failures and switch to polling, which is what the server is
    // asking for anyway.
    es.addEventListener('error', () => {
      failures += 1;
      if (failures >= SSE_MAX_CONSECUTIVE_FAILURES) {
        es.close();
        setFeedModeOverride('polling');
      }
    });

    // On reconnect (open fires again after a drop), re-fetch the full question
    // list so any events missed during the disconnection are caught up.
    es.addEventListener('open', () => {
      failures = 0; // a successful connect clears the fallback countdown
      if (!reconnecting) { reconnecting = true; return; } // skip the initial open
      api.get<{ data: Question[] }>(`/questions?sessionId=${sessionId}&sort=${sortRef.current}`)
        .then(r => setQuestions(r.data))
        .catch(() => {});
    });

    es.addEventListener('question:new', (e) => {
      const q: Question = JSON.parse(e.data);
      // An approved question arrives here as 'new' and leaves the pending queue.
      setPendingQuestions(prev => prev.filter(p => p.id !== q.id));
      setQuestions(prev => prev.some(x => x.id === q.id) ? prev : [q, ...prev]);
      if (!atTopRef.current) setNewQuestionsCount(n => n + 1);
    });

    // Sent to hosts/mods only, on sessions that require approval.
    es.addEventListener('question:pending', (e) => {
      const q: Question = JSON.parse(e.data);
      setPendingQuestions(prev => prev.some(x => x.id === q.id) ? prev : [q, ...prev]);
    });
    es.addEventListener('echo:added', (e) => {
      const { questionId, vote_count } = JSON.parse(e.data);
      setQuestions(prev => prev.map(q => q.id === questionId ? { ...q, vote_count } : q));
    });
    es.addEventListener('question:updated', (e) => {
      const updated: Question = JSON.parse(e.data);
      setQuestions(prev => prev.map(q => q.id === updated.id ? updated : q));
    });
    // Sent to the audience in place of question:updated when a question is
    // hidden — the body is deliberately not included, so drop it outright.
    es.addEventListener('question:removed', (e) => {
      const { id } = JSON.parse(e.data);
      setQuestions(prev => prev.filter(q => q.id !== id));
      setPendingQuestions(prev => prev.filter(q => q.id !== id));
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
  }, [session?.id, feedMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Guest sign-up prompt ──────────────────────────────────────────────────
  // Show the conversion prompt whenever a guest hits 0 credits.
  useEffect(() => {
    if (!loading && !isRegistered && credits === 0 && session?.status !== 'closed') {
      setShowSignupPrompt(true);
    }
  }, [credits, isRegistered, loading, session?.status]);

  // ── Credit regen heartbeat ────────────────────────────────────────────────

  const lastHeartbeatRef = useRef(0);

  const sendHeartbeat = useCallback(() => {
    if (!sessionId) return;
    // Nothing to sync until the visitor actually has an identity. A guest who
    // has not picked a display name yet holds no token, and this would just 401.
    if (typeof window !== 'undefined' && !localStorage.getItem('aa_token')) return;

    const now = Date.now();
    if (now - lastHeartbeatRef.current < MIN_HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeatRef.current = now;
    api.post<{ credits_remaining: number; regen_exhausted?: boolean; next_credit_secs?: number }>(
      `/sessions/${sessionId}/heartbeat`, {}
    ).then(r => {
      setCredits(r.credits_remaining);
      // Seed the timer from the server's authoritative value so refreshes don't reset the countdown
      if (r.next_credit_secs !== undefined) setNextCreditSecs(r.next_credit_secs);
      if (r.regen_exhausted) {
        setRegenExhausted((prev: boolean) => {
          if (!prev) setShowRegenModal(true);
          return true;
        });
      }
    }).catch((err) => {
      // Swallowed so a failed tick never breaks the session UI — but not
      // silently. A bad SQL query made this endpoint 500 on every call and the
      // bare catch hid it completely, which meant the credit meter never
      // refreshed and the guest sign-up prompt never fired.
      console.error('[heartbeat] credit sync failed:', err);
    });
  }, [sessionId]);

  // Sync the timer with the server's last_credit_at — on load, and again once
  // the visitor has joined. A guest picks their display name after mount, so
  // syncing only on mount would leave their countdown running on a guess.
  useEffect(() => {
    if (!sessionId || sessionStatus === 'closed') return;
    if (ELEVATED_ROLES.includes(callerRole)) return;
    sendHeartbeat();
  }, [sessionId, sessionStatus, callerRole, joinCount, sendHeartbeat]);

  // Tick down every second; fire heartbeat when it hits zero
  useEffect(() => {
    if (!sessionId || sessionStatus === 'closed') return;
    if (ELEVATED_ROLES.includes(callerRole)) return;

    const interval = setInterval(() => {
      // The request is fired here, not inside the setState updater. React may
      // invoke an updater more than once for a single update, so calling
      // sendHeartbeat() in there produced a burst of requests per tick.
      let due = false;
      setNextCreditSecs(prev => {
        if (prev <= 1) { due = true; return REGEN_SECS; }
        return prev - 1;
      });
      if (due) sendHeartbeat();
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionId, sessionStatus, callerRole, sendHeartbeat]);

  // ── Similar detection ─────────────────────────────────────────────────────

  const fetchSimilar = useCallback((q: string) => {
    if (!sessionId || q.trim().length < 4) { setSimilarQuestions([]); return; }
    clearTimeout(similarTimer.current);
    similarTimer.current = setTimeout(async () => {
      try {
        const results = await api.get<Question[]>(
          `/questions/similar?sessionId=${sessionId}&q=${encodeURIComponent(q)}`
        );
        setSimilarQuestions(results);
      } catch { setSimilarQuestions([]); }
    }, 400);
  }, [sessionId]);

  // ── Submit question ───────────────────────────────────────────────────────

  async function submitQuestion() {
    if (!session || !body.trim()) return;
    if (!isMod && (postAnonymously ? anonCredits < 1 : credits < 1)) return;
    if (burstCooldown > 0) return;
    setSubmitting(true); setError(null);
    try {
      const q = await api.post<Question>('/questions', {
        session_id: session.id,
        body: body.trim(),
        ...(postAnonymously && { post_anonymously: true }),
      });
      setBody(''); setSimilarQuestions([]);
      if (postAnonymously) {
        setAnonCredits(c => c - 1);
      } else {
        setCredits(c => c - 1);
      }
      setMyQuestionIds(prev => new Set([...prev, q.id]));
    } catch (err: any) {
      // 429 burst limit — parse seconds from message and start local countdown
      const secsMatch = err.message?.match(/(\d+)s/);
      if (secsMatch) {
        const secs = parseInt(secsMatch[1]);
        setBurstCooldown(secs);
        clearInterval(burstTimerRef.current);
        burstTimerRef.current = setInterval(() => {
          setBurstCooldown(prev => {
            if (prev <= 1) { clearInterval(burstTimerRef.current); return 0; }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(err.message);
      }
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
    // Capture the prior state so a failed request can actually be undone. This
    // used to claim it reverted and never did, so a rejected moderation action
    // left the host looking at a change the server had refused.
    const previous = questions.find(q => q.id === questionId);

    // Optimistic update — don't wait for SSE round-trip
    setQuestions(prev => prev.map(q =>
      q.id === questionId
        ? { ...q, status: status as any, is_spotlighted: status === 'answered' ? false : (q as any).is_spotlighted }
        : q
    ));
    try {
      await api.patch(`/questions/${questionId}/status`, { status });
    } catch (err: any) {
      setError(err.message);
      if (previous) {
        setQuestions(prev => prev.map(q => q.id === questionId ? previous : q));
      }
    }
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

  async function handleReport(reason: string, details: string) {
    if (!session) return;
    try {
      await api.post(`/sessions/${session.id}/report`, { reason, details: details || undefined });
      setShowReport(false);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 4000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit report');
    }
  }

  async function handleExport() {
    if (!session) return;
    try {
      const token = localStorage.getItem('aa_token');
      const res = await fetch(`${API_BASE}/api/sessions/${session.id}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = '';
        try { const b = await res.json(); msg = b.error ?? b.message ?? ''; }
        catch { msg = await res.text().catch(() => ''); }
        setError(`Export failed (${res.status})${msg ? `: ${msg}` : ''}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('content-disposition') ?? '';
      a.download = disposition.split('filename="')[1]?.replace('"', '') || 'qa.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(`Export failed: ${err.message ?? 'Network error'}`);
    }
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
      // Preserve caller_role/mod_permissions — reopen endpoint returns a plain Session
      setSession(prev => ({ ...updated, caller_role: prev?.caller_role, mod_permissions: prev?.mod_permissions }));
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
    setJoinCount(n => n + 1);
    setShowUsernamePicker(false);
  }

  // ── Display ───────────────────────────────────────────────────────────────

  const isMod = ELEVATED_ROLES.includes(callerRole);
  // Hosts/org owners have all permissions; mods only have what their permission record grants.
  const isOwnerLevel = ['host', 'org_owner', 'org_admin'].includes(callerRole);
  const canMute   = isOwnerLevel || !!(session?.mod_permissions?.can_mute);
  const canRemove = isOwnerLevel || !!(session?.mod_permissions?.can_remove);

  // The Hidden tab only exists for staff in host view. Dropping either — turning
  // host view off, or losing the role — must not strand them on a tab that is no
  // longer rendered, showing an empty feed and no way back.
  useEffect(() => {
    if (sort === 'hidden' && !(isMod && hostView)) setSort('echoes');
  }, [sort, isMod, hostView]);

  const displayedQuestions = [...questions].filter(q => {
    // Hidden questions are only ever visible to session staff, and only on the
    // Hidden tab. They used to sit inline in every tab for a moderator, which
    // meant something removed from the audience's view still appeared at the top
    // of the host's feed labelled "TOP QUESTION" — the opposite of what hiding
    // is for, and easy to mistake for the hide not having worked.
    if (q.status === 'hidden') return isMod && hostView && sort === 'hidden';
    if (sort === 'hidden') return false;

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
        nextCreditSecs={isMod ? undefined : nextCreditSecs}
        creditCap={CREDIT_CAP}
        regenCap={REGEN_CAP}
        isRegistered={isRegistered}
        regenExhausted={regenExhausted}
        slug={params.slug}
        onToggleHostView={() => setHostView(v => !v)}
        onReport={!isMod ? () => setShowReport(true) : undefined}
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
          {/* Nav links */}
          <div className="px-4 py-3 border-b border-brand-border/40 flex items-center justify-between">
            <Link href="/discover" className="text-xs text-purple-200/85 hover:text-white transition-colors flex items-center gap-1.5">
              <span>←</span> Discover
            </Link>
            {isRegistered
              ? <Link href="/dashboard" className="text-xs text-purple-200/85 hover:text-white transition-colors">Dashboard</Link>
              : <Link href="/login" className="text-xs text-brand-orange/80 hover:text-brand-orange transition-colors">Sign in</Link>
            }
          </div>
          <div className="p-5 flex flex-col gap-5">
            <div>
              <p className="text-[10px] font-bold text-purple-200/90 uppercase tracking-widest mb-3">Session</p>
              <h2 className="font-bold text-white text-sm leading-snug mb-1">{session.title}</h2>
              {session.host_username && (
                <p className="text-xs text-purple-200/85">Hosted by <span className="text-brand-amber font-semibold">{session.host_username}</span></p>
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
                  <span className="text-xs text-purple-200/85">{s.label}</span>
                  <span className="text-lg font-bold text-white">{s.value}</span>
                </div>
              ))}
              {participantCount !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-purple-200/85">Attending</span>
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
                  <p className="text-xs font-bold text-purple-200/90 mb-1">Join code</p>
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
                <p className="text-xs text-purple-200/85 mt-0.5">Questions</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-white">{(session as any).participant_count ?? '—'}</p>
                <p className="text-xs text-purple-200/85 mt-0.5">Participants</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-brand-amber">{(session as any).total_echoes ?? '—'}</p>
                <p className="text-xs text-purple-200/85 mt-0.5">Total Echoes</p>
              </div>
              {session.ends_at && (
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">{new Date(session.ends_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  <p className="text-xs text-purple-200/85 mt-0.5">Session date</p>
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
                    : 'bg-brand-card border-brand-border/50 text-purple-200/85'
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
                    <p className="text-center text-xs text-purple-200/75 py-4">No questions waiting for approval.</p>
                  )}
                  {pendingQuestions.map(q => (
                    <div key={q.id} className="card p-4 border-amber-500/20">
                      <p className="text-white text-sm leading-relaxed mb-1">{q.body}</p>
                      {q.author_username && <p className="text-xs text-purple-200/75 mb-3">{q.author_username}</p>}
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
          <SortTabs
            sort={sort}
            onChange={setSort}
            showHidden={isMod && hostView}
            hiddenCount={questions.filter(q => q.status === 'hidden').length}
          />

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
                onMute={canMute && featuredQuestion.participant_id && !myQuestionIds.has(featuredQuestion.id) ? () => muteAuthor(featuredQuestion.participant_id!, !!featuredQuestion.author_is_muted) : undefined}
                onRemove={canRemove && featuredQuestion.participant_id && !myQuestionIds.has(featuredQuestion.id) ? () => removeAuthor(featuredQuestion.participant_id!) : undefined}
              />
            )}

            {/* Remaining questions */}
            {listQuestions.length === 0 && !featuredQuestion && (
              <div className="text-center py-16 text-purple-200/85">
                <p className="text-4xl mb-3">
                  {sort === 'starred' ? '★' : sort === 'answered' ? '✓' : sort === 'hidden' ? '🚫' : '❓'}
                </p>
                <p className="font-medium">
                  {sort === 'starred'  ? 'No starred questions yet.'   :
                   sort === 'answered' ? 'No answered questions yet.'  :
                   sort === 'hidden'   ? 'Nothing hidden.'             :
                   'No questions yet.'}
                </p>
                <p className="text-sm mt-1">
                  {sort === 'starred'  ? 'Star a question to save it here.' :
                   sort === 'answered' ? 'Questions appear here once marked answered.' :
                   sort === 'hidden'   ? 'Questions you hide are kept here, out of the audience\u2019s view.' :
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
                onMute={canMute && q.participant_id && !myQuestionIds.has(q.id) ? () => muteAuthor(q.participant_id!, !!q.author_is_muted) : undefined}
                onRemove={canRemove && q.participant_id && !myQuestionIds.has(q.id) ? () => removeAuthor(q.participant_id!) : undefined}
              />
            ))}
          </div>
        </main>

        {/* ── Right sidebar (desktop only) ────────────────────────────────── */}
        <aside className="hidden xl:flex flex-col w-64 border-l border-brand-border shrink-0 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
          {/* Top Questions */}
          <div className="p-5 border-b border-brand-border/40">
            <p className="text-[10px] font-bold text-purple-200/90 uppercase tracking-widest mb-4">Top Questions</p>
            <div className="flex flex-col gap-3">
              {questions
                .filter(q => q.status !== 'hidden' && q.status !== 'answered')
                .sort((a, b) => b.vote_count - a.vote_count)
                .slice(0, 5)
                .map((q, i) => (
                  <div key={q.id} className="flex items-start gap-2.5">
                    <span className={`text-xs font-bold w-4 shrink-0 mt-0.5 ${i === 0 ? 'text-brand-amber' : 'text-purple-200/55'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-purple-200/80 leading-relaxed line-clamp-2">{q.body}</p>
                      <p className="text-[11px] text-brand-orange mt-0.5">{q.vote_count} echoes</p>
                    </div>
                  </div>
                ))}
              {questions.filter(q => q.status !== 'hidden').length === 0 && (
                <p className="text-xs text-purple-200/85 text-center py-4">No questions yet</p>
              )}
            </div>
          </div>

          {/* Top Participants */}
          {(() => {
            const map = new Map<string, number>();
            questions.forEach(q => {
              if (q.post_anonymously || !q.author_username) return;
              map.set(q.author_username, (map.get(q.author_username) ?? 0) + q.vote_count);
            });
            const top = [...map.entries()]
              .map(([name, echoes]) => ({ name, echoes }))
              .sort((a, b) => b.echoes - a.echoes)
              .slice(0, 5);
            if (!top.length) return null;
            return (
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold text-purple-200/90 uppercase tracking-widest">Top Participants</p>
                  <p className="text-[10px] text-purple-200/70">Echoes received</p>
                </div>
                <div className="flex flex-col gap-3">
                  {top.map((p, i) => (
                    <div key={p.name} className="flex items-center gap-2.5">
                      <span className={`text-xs font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-brand-amber' : 'text-purple-200/55'}`}>
                        {i + 1}
                      </span>
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: `hsl(${(p.name.charCodeAt(0) * 37) % 360} 60% 45%)` }}
                      >
                        {p.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-purple-200/85 truncate">{p.name}</p>
                        <p className="text-[11px] text-purple-200/70">{p.echoes} echoes received</p>
                      </div>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-brand-amber/20 text-brand-amber' : 'bg-white/5 text-purple-200/65'}`}>
                        {p.echoes}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </aside>
      </div>

      {/* Submit bar */}
      {!submissionClosed && (
        <SubmitBar
          body={body}
          setBody={(v) => { setBody(v); fetchSimilar(v); }}
          credits={credits}
          anonCredits={anonCredits}
          submitting={submitting}
          similarQuestions={similarQuestions}
          onSubmit={submitQuestion}
          onEchoSimilar={addEcho}
          sessionStatus={session.status}
          isRegistered={isRegistered}
          postAnonymously={postAnonymously}
          onToggleAnon={() => setPostAnonymously(p => !p)}
          isMod={isMod}
          burstCooldown={burstCooldown}
        />
      )}

      {submissionClosed && session.status !== 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-purple-200/85">
          Question submission has closed for this session.
        </div>
      )}

      {session.status === 'closed' && (
        <div className="fixed bottom-0 inset-x-0 bg-brand-card border-t border-brand-border px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-purple-200/85">
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

      {/* Guest sign-up prompt — shown when guest credits hit 0 */}
      {showSignupPrompt && !isRegistered && session && (
        <GuestSignupPrompt slug={params.slug} onDismiss={() => setShowSignupPrompt(false)} />
      )}

      {/* Regen-exhausted upgrade modal — shown when guest uses their last free regen credit */}
      {showRegenModal && !isRegistered && !showSignupPrompt && session && (
        <RegenUpgradeModal slug={params.slug} onDismiss={() => setShowRegenModal(false)} />
      )}

      {/* Moderator panel */}
      {showModPanel && session && (
        <ModeratorPanel sessionId={session.id} hostId={session.host_id} onClose={() => setShowModPanel(false)} />
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

      {/* Report session modal */}
      {showReport && (
        <ReportSessionModal
          onSubmit={handleReport}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Report success toast */}
      {reportDone && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-900/90 border border-green-500/40 text-green-200 text-sm px-4 py-2.5 rounded-lg shadow-lg">
          Report submitted — thank you.
        </div>
      )}
    </div>
  );
}

// ─── Session header ───────────────────────────────────────────────────────────

function SessionHeader({ session, isLiveSoon, credits, isMod, hostView, participantCount, nextCreditSecs, creditCap, regenCap, isRegistered, regenExhausted, slug, onToggleHostView, onReport }: {
  session: Session;
  isLiveSoon: boolean;
  credits: number;
  isMod: boolean;
  hostView: boolean;
  participantCount: number | null;
  nextCreditSecs?: number;
  creditCap?: number;
  regenCap?: number;
  isRegistered?: boolean;
  regenExhausted?: boolean;
  slug?: string;
  onToggleHostView: () => void;
  onReport?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 bg-brand-bg/90 backdrop-blur border-b border-brand-border/50">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusBadge status={session.status} isLiveSoon={isLiveSoon} />
            {session.status === 'live' && participantCount !== null && (
              <span className="text-xs text-purple-200/85 flex items-center gap-1">
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
            <p className="text-purple-200/90 text-xs mt-0.5">hosted by {session.host_username}</p>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {!isMod && <CreditDisplay credits={credits} max={session.credits_per_user} nextCreditSecs={nextCreditSecs} creditCap={creditCap} regenCap={regenCap} isRegistered={isRegistered} regenExhausted={regenExhausted} slug={slug} />}
          {isMod && (
            <button
              onClick={onToggleHostView}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                hostView
                  ? 'bg-brand-orange/20 border-brand-orange text-brand-orange'
                  : 'border-brand-border text-purple-200/90 hover:border-brand-orange hover:text-brand-orange'
              }`}
            >
              {hostView ? '★ Host view' : 'Host view'}
            </button>
          )}
          <div className="flex items-center gap-3 lg:hidden">
            <Link href="/discover" className="text-xs text-purple-200/85 hover:text-white transition-colors">← Discover</Link>
            {isMod
              ? null
              : <Link href="/dashboard" className="text-xs text-purple-200/75 hover:text-white transition-colors">Dashboard</Link>
            }
            {!isMod && onReport && (
              <button
                onClick={onReport}
                title="Report this session"
                className="text-purple-200/40 hover:text-red-400/70 transition-colors"
              >
                <FlagIcon />
              </button>
            )}
          </div>
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

          {/* Primary session action — owner-only */}
          {isOwner && session.status === 'upcoming' && (
            <button
              onClick={() => { if (confirm('Go live now?')) onGoLive(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/25 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Go live
            </button>
          )}
          {isOwner && session.status === 'live' && (
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
              <span className="text-xs font-semibold text-purple-200/85 uppercase tracking-wider">Session ended</span>
              {isOwner && (
                <>
                  <button onClick={onExport} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-brand-border text-purple-200/90 hover:text-white transition-colors">
                    <DownloadIcon /> Export CSV
                  </button>
                  <button onClick={onReopen} disabled={reopening} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-600/50 text-emerald-400 hover:bg-emerald-900/20 transition-colors disabled:opacity-40">
                    {reopening ? 'Reopening…' : 'Reopen'}
                  </button>
                  <button onClick={onDelete} disabled={deleting} className="text-xs px-3 py-1.5 rounded-lg border border-red-700/40 text-red-400/70 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40">
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Join code — tappable to copy */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={copyCode}
              title="Tap to copy join code"
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border font-mono transition-colors sm:ml-auto min-h-[44px] ${
                copied ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-white hover:border-brand-purple'
              }`}
            >
              <span className="text-purple-200/85 text-xs font-sans">Code</span>
              <span className="text-sm font-bold tracking-widest">{joinCode}</span>
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          )}

          {/* QR toggle */}
          {joinCode && session.status !== 'closed' && (
            <button
              onClick={() => setShowQR(v => !v)}
              title="Show QR code"
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${showQR ? 'border-brand-purple text-brand-purple' : 'border-brand-border text-purple-200/85 hover:text-white hover:border-brand-border'}`}
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
              className={`p-2.5 rounded-lg border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${shared ? 'border-emerald-500/50 text-emerald-400' : 'border-brand-border text-purple-200/85 hover:text-white hover:border-brand-border'}`}>
              {shared ? <CheckIcon /> : <ShareIcon />}
            </button>
          )}
        </div>

        {/* Secondary row — owner-only admin actions */}
        {isOwner && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-brand-border/30 max-w-7xl">
            <Link href={`/s/${session.slug}/edit`} className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors">Edit session</Link>
            <span className="text-brand-border">·</span>
            <button onClick={onManageMods} className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors">Manage moderators</button>
          </div>
        )}
      </div>

      {/* QR panel */}
      {showQR && joinUrl && (
        <div className="border-t border-brand-border/30 py-4 flex flex-col items-center gap-2">
          <div className="bg-white rounded-2xl p-4 inline-block">
            <QRCode value={joinUrl} size={160} />
          </div>
          <p className="text-xs text-purple-200/85">Audience scans to join — no app needed</p>
        </div>
      )}
    </div>
  );
}

// ─── Credit display ───────────────────────────────────────────────────────────

function CreditDisplay({ credits, max, nextCreditSecs, creditCap, regenCap, isRegistered, regenExhausted, slug }: {
  credits: number;
  max: number;
  nextCreditSecs?: number;
  creditCap?: number;
  regenCap?: number;
  isRegistered?: boolean;
  regenExhausted?: boolean;
  slug?: string;
}) {
  const cap = creditCap ?? max;
  const regenTo = regenCap ?? cap;

  // The countdown appears only when a credit is genuinely on its way.
  //
  // It used to appear whenever any credit had been spent, measured against the
  // host's per-user setting rather than the ceiling regeneration actually
  // refills to. For a guest those differ — a host may grant 6, but regeneration
  // stops at 2 — so a guest sitting on 5 credits was shown "+1 in 10:00" for a
  // credit that was never coming, and the timer appeared to restart on every
  // reload because the server keeps reporting a full interval when nothing is
  // pending.
  const regenPending = credits < regenTo && !regenExhausted;
  const showCountdown = nextCreditSecs !== undefined && regenPending;
  const mins = Math.floor((nextCreditSecs ?? 0) / 60);
  const secs = String((nextCreditSecs ?? 0) % 60).padStart(2, '0');

  // Guests see the free tier stated plainly once they are at or below it. The
  // empty dots above regenTo are deliberate — they show what an account unlocks
  // — but on their own they read as credits that are simply missing.
  const showGuestTier = !isRegistered && credits <= regenTo && !showCountdown;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-purple-200/85 hidden sm:inline">Credits</span>
      <div className="flex gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <div key={i} className={`w-2.5 h-2.5 rounded-full transition-colors ${i < credits ? 'bg-brand-orange' : 'bg-brand-border/60'}`} />
        ))}
      </div>
      <span className={`text-xs font-bold ${credits > 0 ? 'text-brand-amber' : 'text-purple-200/85'}`}>{credits}</span>
      {showCountdown && (
        <span className="text-xs text-purple-200/90 tabular-nums">+1 in {mins}:{secs}</span>
      )}
      {showGuestTier && (
        <span className="text-xs text-purple-200/85 whitespace-nowrap">
          <span className="text-brand-amber font-semibold">{credits}/{regenTo}</span> free ·{' '}
          <Link
            href={`/register${slug ? `?next=${encodeURIComponent(`/s/${slug}`)}` : ''}`}
            className="text-brand-orange font-semibold hover:text-brand-amber transition-colors"
          >
            Sign up for more
          </Link>
        </span>
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
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/90 text-xs font-semibold">Ended</span>
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

function SortTabs({ sort, onChange, showHidden = false, hiddenCount = 0 }: {
  sort: SortOption;
  onChange: (s: SortOption) => void;
  /** Session staff only — the audience must not learn that hidden content exists. */
  showHidden?: boolean;
  hiddenCount?: number;
}) {
  const tabs = showHidden
    ? [...SORT_TABS, { value: 'hidden' as SortOption, label: `🚫 Hidden${hiddenCount ? ` (${hiddenCount})` : ''}` }]
    : SORT_TABS;

  return (
    <div className="flex border-b border-brand-border/60 overflow-x-auto gap-0">
      {tabs.map(tab => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all ${
            sort === tab.value
              ? 'border-brand-orange text-white'
              : 'border-transparent text-purple-200/85 hover:text-purple-200/90'
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
  onMute, onRemove }: {
  question: Question & { is_pinned?: boolean; is_spotlighted?: boolean };
  isEchoed: boolean; isMine: boolean; creditsLeft: number;
  onEcho: () => void; hostView: boolean;
  onStar: () => void; onAnswered: () => void; onHide: () => void;
  onPin: () => void; onSpotlight: () => void; onReply: () => void;
  onMute?: () => void; onRemove?: () => void;
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
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/85'}`}>
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
                <button onClick={onSpotlight} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${isSpotlighted ? 'bg-amber-500/20 border-amber-400/50 text-amber-300' : 'border-brand-border/60 text-purple-200/90 hover:border-amber-400/40 hover:text-amber-300'}`}>🎙 Now Answering</button>
                <button onClick={onStar} className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'starred' ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400' : 'border-brand-border/60 text-purple-200/85 hover:text-yellow-400'}`}>★ Star</button>
                <button onClick={onAnswered} className={`text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'answered' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'border-brand-border/60 text-purple-200/85 hover:text-emerald-400'}`}>{question.status === 'answered' ? '✓ Answered' : '✓ Answered'}</button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={question.is_pinned ? 'Unpin' : 'Pin'} active={!!question.is_pinned}>{question.is_pinned ? 'Unpin' : 'Pin'}</ModButton>
                <ModButton onClick={onHide} title="Hide question" danger={question.status !== 'hidden'} active={question.status === 'hidden'}>{question.status === 'hidden' ? 'Unhide' : 'Hide'}</ModButton>
                <ModButton onClick={onReply} title="Reply">Reply</ModButton>
                {onMute && <ModButton onClick={onMute} title={question.author_is_muted ? 'Unmute user' : 'Mute user'} active={!!question.author_is_muted} danger={!question.author_is_muted}>{question.author_is_muted ? 'Unmute User' : 'Mute User'}</ModButton>}
                {onRemove && <ModButton onClick={() => { if (confirm('Remove this person from the session?')) onRemove!(); }} title="Remove user" danger>Remove User</ModButton>}
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
                ? 'border-brand-border text-purple-200/90 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/70 cursor-not-allowed'
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
  onMute, onRemove }: {
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
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/75'}`}>
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
                  title={isSpotlighted ? 'Clear Now Answering' : 'Mark as Now Answering'}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    isSpotlighted
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                      : 'border-brand-border/60 text-purple-200/90 hover:border-amber-400/40 hover:text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  🎙 Now Answering
                </button>

                {/* Star */}
                <button
                  onClick={onStar}
                  title={question.status === 'starred' ? 'Remove star' : 'Star this question'}
                  className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    question.status === 'starred'
                      ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                      : 'border-brand-border/60 text-purple-200/85 hover:text-yellow-400 hover:border-yellow-500/30'
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
                      : 'border-brand-border/60 text-purple-200/85 hover:text-emerald-400 hover:border-emerald-500/30'
                  }`}
                >
                  {question.status === 'answered' ? '✓ Answered' : '✓ Answered'}
                </button>
              </div>

              {/* Secondary actions row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={isPinned ? 'Unpin' : 'Pin to top'} active={isPinned}>
                  {isPinned ? 'Unpin' : 'Pin'}
                </ModButton>
                <ModButton onClick={onHide} title={question.status === 'hidden' ? 'Unhide question' : 'Hide question'} danger={question.status !== 'hidden'} active={question.status === 'hidden'}>
                  {question.status === 'hidden' ? 'Unhide' : 'Hide'}
                </ModButton>
                <ModButton onClick={onReply} title="Add host reply">Reply</ModButton>
                {onMute && (
                  <ModButton onClick={onMute} title={question.author_is_muted ? 'Unmute user' : 'Mute user'} active={!!question.author_is_muted} danger={!question.author_is_muted}>
                    {question.author_is_muted ? 'Unmute User' : 'Mute User'}
                  </ModButton>
                )}
                {onRemove && (
                  <ModButton onClick={() => { if (confirm('Remove this person from the session?')) onRemove!(); }} title="Remove user from session" danger>Remove User</ModButton>
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
                ? 'border-brand-border text-purple-200/90 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/70 cursor-not-allowed'
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
                  'border-brand-border/60 text-purple-200/90 hover:border-brand-purple hover:text-white'
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
          <button onClick={onClose} className="text-purple-200/85 hover:text-white transition-colors p-1" aria-label="Close">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p className="text-purple-200/90 text-sm mb-4 line-clamp-2">{question.body}</p>
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

function SubmitBar({ body, setBody, credits, anonCredits, submitting, similarQuestions, onSubmit, onEchoSimilar, sessionStatus, isRegistered, postAnonymously, onToggleAnon, isMod, burstCooldown }: {
  body: string; setBody: (v: string) => void;
  credits: number; anonCredits: number; submitting: boolean;
  similarQuestions: Question[];
  onSubmit: () => void; onEchoSimilar: (id: string) => void;
  sessionStatus: string;
  isRegistered: boolean;
  postAnonymously: boolean;
  onToggleAnon: () => void;
  isMod?: boolean;
  burstCooldown?: number;
}) {
  const MAX = 300;
  const remaining = MAX - body.length;
  const effectiveCredits = postAnonymously ? anonCredits : credits;
  const canSubmit = body.trim().length > 0 && (isMod || effectiveCredits > 0) && !submitting && sessionStatus !== 'closed' && !burstCooldown;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-card border-t border-brand-border shadow-2xl pb-[env(safe-area-inset-bottom)]">
      {similarQuestions.length > 0 && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <p className="text-xs text-brand-orange font-semibold mb-2">Similar questions already asked:</p>
          <div className="space-y-2 mb-3 max-h-[100px] sm:max-h-none overflow-y-auto">
            {similarQuestions.slice(0, 3).map(q => (
              <div key={q.id} className="flex items-center gap-3 bg-brand-card rounded-xl px-3 py-2 border border-brand-border/50">
                <p className="flex-1 text-xs text-purple-200/90 leading-snug">{q.body}</p>
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
            placeholder={isMod || effectiveCredits > 0 ? 'Ask a question…' : postAnonymously ? 'Anonymous limit reached — post with your name to continue' : 'No credits remaining'}
            disabled={!isMod && effectiveCredits < 1}
            maxLength={300}
            rows={2}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 pr-12
                       text-white text-base placeholder-purple-200/40 resize-none
                       focus:outline-none focus:border-brand-purple transition-colors disabled:opacity-40"
          />
          <span className={`absolute right-3 bottom-3 text-xs ${remaining < 50 ? 'text-red-400' : 'text-purple-200/85'}`}>
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
                  : 'bg-white/5 border-white/10 text-purple-200/85 hover:text-purple-200/90'
              }`}
            >
              {/* Mask icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" />
                <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" />
              </svg>
              {postAnonymously ? `Anon on (${anonCredits} left)` : 'Anon off'}
            </button>
          )}
          <button onClick={onSubmit} disabled={!canSubmit} className="btn-primary px-4 py-3 disabled:opacity-40 disabled:cursor-not-allowed min-w-[64px] text-center">
            {submitting ? '…' : burstCooldown ? `${burstCooldown}s` : 'Ask'}
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
        <p className="text-purple-200/90 text-sm">Joining session…</p>
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
        <p className="text-purple-200/90 text-sm mb-6">{message}</p>
        <Link href="/" className="btn-primary">Back to GuestSpeak</Link>
      </div>
    </div>
  );
}

// ─── Guest sign-up prompt ────────────────────────────────────────────────────

function GuestSignupPrompt({ slug, onDismiss }: { slug: string; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="card p-7 w-full max-w-sm text-center mb-4 sm:mb-0">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-brand-orange" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 6.375a4.125 4.125 0 118.25 0 4.125 4.125 0 01-8.25 0zM14.25 8.625a3.375 3.375 0 116.75 0 3.375 3.375 0 01-6.75 0zM1.5 19.125a7.125 7.125 0 0114.25 0v.003l-.001.119a.75.75 0 01-.363.63 13.067 13.067 0 01-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 01-.364-.63l-.001-.122zM17.25 19.128l-.001.144a2.25 2.25 0 01-.233.96 10.088 10.088 0 005.06-1.01.75.75 0 00.42-.643 4.875 4.875 0 00-6.957-4.611 8.586 8.586 0 011.71 5.157v.003z" />
          </svg>
        </div>

        <h2 className="text-white font-bold text-xl mb-2">Keep contributing!</h2>
        <p className="text-purple-200/80 text-sm leading-relaxed mb-6">
          You&apos;ve used your credits for now. Sign up free and there&apos;s{' '}
          <span className="text-brand-amber font-semibold">no cap on additional earned credits</span>{' '}
          — keep earning as long as the event goes on.
        </p>

        <Link
          href={`/register?next=${encodeURIComponent('/s/' + slug)}`}
          className="btn-primary w-full py-3 text-sm block mb-3"
        >
          Sign up free — it&apos;s quick
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent('/s/' + slug)}`}
          className="block text-sm text-purple-200/90 hover:text-white transition-colors mb-4"
        >
          Already have an account? Sign in
        </Link>
        <button
          onClick={onDismiss}
          className="text-xs text-purple-200/75 hover:text-purple-200/90 transition-colors"
        >
          Maybe later — continue watching
        </button>
      </div>
    </div>
  );
}

// ─── Regen upgrade modal — inline signup when guest regen is exhausted ────────

function RegenUpgradeModal({ slug, onDismiss }: { slug: string; onDismiss: () => void }) {
  const [email, setEmail]       = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !username || !password) return;
    setLoading(true); setError(null);
    try {
      // The guest's own JWT goes up in the Authorization header (api attaches it),
      // and the server reads the guest token from there. It is deliberately NOT
      // sent in the body: the server used to trust a body parameter, which let
      // anyone who had seen a guest's token — it travels in the SSE query string
      // and a JWT payload is plain base64 — register and claim that guest's
      // questions and participant row.
      const result = await api.post<{ token: string; user: any }>('/auth/register', {
        email, username, password,
      });
      saveAuth(result.token, result.user);
      setSuccess(true);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err: any) {
      setError(err.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="card p-7 w-full max-w-sm text-center mb-4 sm:mb-0">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-xl mb-2">You&apos;re in!</h2>
          <p className="text-purple-200/90 text-sm">Reloading your session with unlimited replenishment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-bg/70 backdrop-blur-sm px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="card p-7 w-full max-w-sm mb-4 sm:mb-0">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-brand-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </div>

        <h2 className="text-white font-bold text-xl text-center mb-1">Keep up your contribution!</h2>
        <p className="text-purple-200/90 text-sm text-center mb-6">
          Create a free account to receive{' '}
          <span className="text-brand-amber font-semibold">unlimited credit replenishment</span>{' '}
          for the rest of this event.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white placeholder-purple-200/40 focus:outline-none focus:border-brand-purple transition-colors"
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            autoComplete="username"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white placeholder-purple-200/40 focus:outline-none focus:border-brand-purple transition-colors"
          />
          <input
            type="password"
            placeholder="Password (8+ characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-sm text-white placeholder-purple-200/40 focus:outline-none focus:border-brand-purple transition-colors"
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading || !email || !username || password.length < 8}
            className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account…' : 'Create account — it\'s free'}
          </button>
        </form>

        <p className="text-xs text-purple-200/75 text-center mt-4">
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent('/s/' + slug)}`}
            className="text-brand-orange hover:text-brand-amber transition-colors"
          >
            Sign in instead
          </Link>
        </p>

        <button
          onClick={onDismiss}
          className="block w-full text-center text-xs text-purple-200/70 hover:text-purple-200/85 transition-colors mt-3"
        >
          Maybe later — I still have credits
        </button>
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
          <p className="text-purple-200/90 text-sm leading-relaxed mb-6">{session.description}</p>
        )}

        <div className="flex items-center justify-center gap-2 mb-8">
          <StatusBadge status={session.status} isLiveSoon={false} />
          {session.host_username && (
            <span className="text-xs text-purple-200/85">· hosted by {session.host_username}</span>
          )}
        </div>

        <button onClick={onEnter} className="btn-primary w-full py-3 text-sm font-bold">
          Enter Q&amp;A
        </button>

        <p className="text-xs text-purple-200/70 mt-5">Powered by GuestSpeak</p>
      </div>
    </div>
  );
}

// ─── Stream embed ─────────────────────────────────────────────────────────────

type StreamInfo =
  | { type: 'youtube'; embedUrl: string; watchUrl: string }
  | { type: 'twitch';  embedUrl: string; watchUrl: string }
  | { type: 'link';    watchUrl: string };

/** Hostname must be the real host or a subdomain of it — never just a substring. */
function isHost(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function parseStream(url: string): StreamInfo | null {
  if (!url) return null;

  // Match on the parsed hostname, not a substring of the whole URL: a bare
  // /youtube\.com/ test also matches https://example.com/youtube.com/x, which
  // would render a player for a URL that isn't a YouTube link at all.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return { type: 'link', watchUrl: url };

  const host = parsed.hostname.replace(/^www\./, '');

  if (isHost(host, 'youtube.com') || isHost(host, 'youtu.be')) {
    const id = isHost(host, 'youtu.be')
      ? parsed.pathname.slice(1)
      : parsed.searchParams.get('v') ?? parsed.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1] ?? '';

    if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
      return {
        type: 'youtube',
        embedUrl: `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1`,
        watchUrl: url,
      };
    }
  }

  if (isHost(host, 'twitch.tv')) {
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'guestspeak.app';

    const videoId = parsed.pathname.match(/^\/videos\/(\d+)$/)?.[1];
    if (videoId) {
      return {
        type: 'twitch',
        embedUrl: `https://player.twitch.tv/?video=${videoId}&parent=${parent}&autoplay=false`,
        watchUrl: url,
      };
    }

    const channel = parsed.pathname.match(/^\/([A-Za-z0-9_]+)\/?$/)?.[1];
    if (channel && channel !== 'videos') {
      return {
        type: 'twitch',
        embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=false`,
        watchUrl: url,
      };
    }
  }

  // Anything else — link fallback
  return { type: 'link', watchUrl: url };
}

function StreamEmbed({ url, sessionSlug }: { url: string; sessionSlug: string }) {
  // Every hook must run before any early return. If the host clears the stream
  // URL mid-session, parseStream starts returning null and a bailout above the
  // useState would change the hook count on an already-mounted component,
  // crashing the page for everyone watching.
  const storageKey = `gs_hide_stream_${sessionSlug}`;
  const [hidden, setHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });

  const info = parseStream(url);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    localStorage.setItem(storageKey, next ? '1' : '0');
  }

  if (!info) return null;

  if (info.type === 'link') {
    return (
      <div className="mb-4 flex items-center gap-3 bg-brand-card border border-brand-border rounded-xl px-4 py-3">
        <svg className="w-5 h-5 text-brand-orange flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-sm text-purple-200/85 flex-1">This session is streaming live</span>
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
          <span className="text-xs font-semibold text-purple-200/90 uppercase tracking-wider">
            {info.type === 'youtube' ? 'YouTube Live' : 'Twitch Stream'}
          </span>
        </div>
        <button
          onClick={toggle}
          className="text-xs text-purple-200/85 hover:text-purple-200/90 transition-colors flex items-center gap-1"
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
          <span className="text-sm text-purple-200/85">Stream hidden</span>
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

function FlagIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

// ─── Report session modal ──────────────────────────────────────────────────────

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'spam',           label: 'Spam or self-promotion' },
  { value: 'inappropriate',  label: 'Inappropriate content' },
  { value: 'impersonation',  label: 'Impersonation' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other',          label: 'Other' },
];

function ReportSessionModal({ onSubmit, onClose }: {
  onSubmit: (reason: string, details: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setLoading(true);
    try {
      await onSubmit(reason, details.trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-brand-card border border-white/10 rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-white mb-1">Report this session</h2>
        <p className="text-xs text-purple-200/60 mb-4">Our team will review your report. Thank you for helping keep things safe.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            {REPORT_REASONS.map(r => (
              <label key={r.value} className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-brand-orange"
                />
                <span className="text-sm text-purple-100/80 group-hover:text-white transition-colors">{r.label}</span>
              </label>
            ))}
          </div>

          <div>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value.slice(0, 500))}
              placeholder="Additional details (optional)"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-purple-200/40 resize-none focus:outline-none focus:border-brand-orange/50"
            />
            <p className="text-xs text-purple-200/40 text-right mt-0.5">{details.length}/500</p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-purple-200/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || loading}
              className="px-4 py-1.5 text-sm bg-red-700/80 hover:bg-red-600/80 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {loading ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
