'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { plural } from '@/lib/plural';
import {
  SessionHeader, HostControlBar, CreditDisplay, SortTabs,
} from '@/components/session/chrome';
import type { SortOption } from '@/components/session/types';
import { SubmitBar } from '@/components/session/SubmitBar';
import {
  FeaturedQuestionCard, QuestionCard, PendingQuestionCard, ModButton, Collapsible,
} from '@/components/session/cards';
import {
  EDIT_WINDOW_SECS, useInlineEdit, InlineEditForm, EditAffordance, FollowUpThread,
} from '@/components/session/inline-edit';
import type { InlineEdit } from '@/components/session/inline-edit';
import { ReplyModal, ReportSessionModal } from '@/components/session/modals';
import {
  LoadingScreen, ErrorScreen, GuestSignupPrompt, RegenUpgradeModal, WelcomeScreen,
  StatusBadge,
} from '@/components/session/screens';
import { StreamEmbed } from '@/components/session/stream';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';
import ChannelAvatar from '@/components/ChannelAvatar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, sseUrl } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
import ModeratorPanel from '@/components/ModeratorPanel';
import GuestUsernameModal from '@/components/GuestUsernameModal';
import QRCode from 'react-qr-code';
import FollowChannel from '@/components/FollowChannel';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionPageProps {
  params: { slug: string };
}

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
  /**
   * Questions mid-exit: answered, filtered out of Top, still on screen for the
   * length of one collapse so the feed does not jolt.
   *
   * Keyed by id rather than a flag on the question, because the question object
   * is replaced wholesale on every feed refresh and a flag would not survive.
   */
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  /** Last seen status per question, to spot the transition rather than the state. */
  const seenStatusRef = useRef<Map<string, string>>(new Map());
  const [myQuestionIds, setMyQuestionIds]   = useState<Set<string>>(new Set());
  /**
   * The caller's own questions awaiting approval.
   *
   * Kept apart from `questions` because they are not in the public feed and
   * must not leak into anything derived from it — echo counts, the featured
   * slot, the Top ordering. They belong to one person and are shown only to
   * them, above the feed, so a question submitted for approval is visible to
   * its author instead of vanishing.
   */
  const [myPending, setMyPending] = useState<Question[]>([]);
  // Which questions are mine is client-side only, and the edit window is short
  // enough that an accidental reload would otherwise eat it. Persisted per
  // session so the button survives a refresh. It is only a hint — the server
  // enforces authorship, so a stale entry just earns a 403.
  const [myIdsHydrated, setMyIdsHydrated]   = useState(false);
  const [nowTs, setNowTs]                   = useState(() => Date.now());
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
  // REGEN_CAP:  the ceiling the heartbeat will regen to. The server reports it,
  //             because it owns both halves: the per-tier cap (2 for guests as a
  //             sign-up incentive, 6 for registered) clamped by the host's
  //             credits_per_user. Duplicating that formula here is how the
  //             countdown ends up promising a credit that is never coming, so
  //             the local expression below is only a stand-in for the first
  //             heartbeat and must stay in step with the server's.
  const CREDIT_CAP  = session?.credits_per_user ?? 3;
  const [serverRegenCap, setServerRegenCap] = useState<number>();
  const [regenPaused, setRegenPaused] = useState(false);
  const REGEN_CAP   = serverRegenCap ?? Math.min(isRegistered ? 6 : 2, CREDIT_CAP);
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
  /**
   * Display order held still while the viewer is reading down the list.
   *
   * Sorting by echoes means the order changes whenever anyone votes, and it
   * changed under whoever was looking at it. Reach for the echo button on the
   * third question, someone else echoes the fifth, it takes the slot you were
   * aiming at and you vote for the wrong thing. At the top of the feed that
   * live re-sort is the point — it is the leaderboard. A few hundred pixels
   * down it is nothing but a moving target.
   *
   * Ranks captured when the viewer scrolls away from the top; null means live.
   * Counts still update on the cards throughout — the numbers move, the cards
   * do not.
   */
  const [frozenOrder, setFrozenOrder] = useState<Map<string, number> | null>(null);
  /** Latest live order, so the scroll handler has something to capture. */
  const liveOrderRef = useRef<Map<string, number>>(new Map());

  const similarTimer = useRef<ReturnType<typeof setTimeout>>();
  const sseRef = useRef<EventSource | null>(null);

  // ─── Author edit window ────────────────────────────────────────────────────

  const mineKey = `askaway:mine:${params.slug}`;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(mineKey);
      if (raw) setMyQuestionIds(new Set(JSON.parse(raw) as string[]));
    } catch { /* private mode, quota, corrupt value — the hint is optional */ }
    setMyIdsHydrated(true);
  }, [mineKey]);

  useEffect(() => {
    // Guarded on hydration, and it has to be state rather than a ref. Both
    // effects run in the same commit on mount, so a ref flipped by the reader
    // above is already true when this runs — and it would then write the empty
    // initial set straight over what was just read. State defers this until the
    // hydrated value has actually landed.
    if (!myIdsHydrated) return;
    try {
      sessionStorage.setItem(mineKey, JSON.stringify([...myQuestionIds]));
    } catch { /* the server copy below is the real source; this is a fast path */ }
  }, [myQuestionIds, myIdsHydrated, mineKey]);


  /** Seconds left to edit a question, or 0 when it is not mine or too late. */
  const editSecondsLeft = useCallback((q: Question) => {
    if (!myQuestionIds.has(q.id) || q.status === 'hidden') return 0;
    const elapsed = (nowTs - Date.parse(q.created_at)) / 1000;
    return Math.max(0, Math.ceil(EDIT_WINDOW_SECS - elapsed));
  }, [myQuestionIds, nowTs]);

  // Ticks only while something of mine is still editable, so a long feed is not
  // re-rendering every second for the whole show.
  useEffect(() => {
    const anyEditable = questions.some(q => editSecondsLeft(q) > 0);
    if (!anyEditable) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [questions, editSecondsLeft]);

  /**
   * Whether this question has a free follow-up waiting on it.
   *
   * Derived here rather than sent by the server: the audience feed is cached
   * and shared between callers, so a per-caller field would poison it. The
   * server is the enforcer either way — a wrong guess here just earns a 4xx —
   * and "is it mine" is already worked out client-side the same way.
   */
  const canFollowUp = useCallback((q: Question) => (
    myQuestionIds.has(q.id)
    && q.status === 'answered'
    && !questions.some(x => x.parent_question_id === q.id && myQuestionIds.has(x.id))
  ), [myQuestionIds, questions]);

  const askFollowUp = useCallback(async (parentId: string, body: string) => {
    const created = await api.post<Question>('/questions', {
      session_id: sessionId, body, parent_question_id: parentId,
    });
    // Same guard the SSE handler uses. The broadcast for this question can
    // arrive before the POST resolves, and appending unconditionally then put
    // the same row in the list twice.
    setQuestions(prev => prev.some(x => x.id === created.id) ? prev : [...prev, created]);
    setMyQuestionIds(prev => new Set([...prev, created.id]));
  }, [sessionId]);

  const editQuestion = useCallback(async (id: string, body: string) => {
    const updated = await api.patch<Question>(`/questions/${id}`, { body });
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, ...updated } : q)));
  }, []);

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

  // Authorship, from the server rather than from this tab.
  //
  // sessionStorage above only ever knew about questions posted in this tab, so
  // closing it forfeited the edit window and — the one that actually matters —
  // the follow-up on an answered question. That right is deliberately good for
  // a day after the session ends, and taking the product up on that means
  // coming back in a new tab, which had an empty set and no button.
  //
  // Merged rather than assigned: a question posted moments ago is already in
  // local state and must not be dropped if this response was in flight when it
  // went out. Runs on join too — a guest picks their name after mount, and the
  // identity that owns anything only exists from that point.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    api.get<{ ids: string[]; pending?: Question[]; echoed?: string[] }>(`/sessions/${sessionId}/mine`)
      .then(({ ids, pending, echoed }) => {
        if (cancelled) return;
        setMyPending(pending ?? []);
        // Merged, not replaced. This request can land after an echo made in
        // the moment before it returned, and replacing would drop that one and
        // show the button again on something already echoed.
        if (echoed?.length) setEchoedIds(prev => new Set([...prev, ...echoed]));
        if (!ids?.length) return;
        setMyQuestionIds(prev => {
          const merged = new Set(prev);
          let added = false;
          for (const id of ids) if (!merged.has(id)) { merged.add(id); added = true; }
          return added ? merged : prev;   // same Set when nothing changed
        });
      })
      .catch(() => { /* the sessionStorage hint still stands */ });
    return () => { cancelled = true; };
  }, [sessionId, joinCount]);

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
    // The server says goodbye before it goes, on deploy or restart. Without
    // this the drop that follows looks exactly like a network failure: it
    // increments the counter, and enough deploys in a row would tip a perfectly
    // healthy connection into the polling fallback for no reason.
    //
    // EventSource reconnects on its own after the stream ends, so there is
    // nothing to do here but decline to hold it against the connection.
    let serverClosing = false;
    es.addEventListener('server:closing', () => {
      serverClosing = true;
      failures = 0;
    });

    es.addEventListener('error', () => {
      // The error that immediately follows a planned close is that close.
      if (serverClosing) { serverClosing = false; return; }
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
      // An approved question arrives here as an ordinary new question, so it
      // has to leave the pending strip or the author sees it twice.
      try {
        const incoming = JSON.parse(e.data);
        const arrivedId = incoming?.id ?? incoming?.data?.id;
        if (arrivedId) setMyPending(prev => prev.filter(p => p.id !== arrivedId));
      } catch { /* the handler below does the real work */ }
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
      // And let the list reorder, even mid-scroll.
      //
      // The frozen order exists so questions arriving on their own do not
      // rearrange the feed under someone reading it. A spotlight is the
      // opposite kind of event: the host saying "this is the one I am answering
      // now". Holding the old order meant the host picked a question — which
      // they do while scrolled down the list, because that is where the
      // question is — and nothing moved for anyone.
      setFrozenOrder(null);
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
      if (top) {
        setNewQuestionsCount(0);
        setFrozenOrder(null);
      } else {
        // Capture once. Already frozen returns the same Map, so React bails
        // out and this stays free to call on every scroll event.
        setFrozenOrder(prev => prev ?? new Map(liveOrderRef.current));
      }
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
    api.post<{ credits_remaining: number; regen_exhausted?: boolean; next_credit_secs?: number; regen_cap?: number; regen_paused?: boolean }>(
      `/sessions/${sessionId}/heartbeat`, {}
    ).then(r => {
      setCredits(r.credits_remaining);
      // Seed the timer from the server's authoritative value so refreshes don't reset the countdown
      if (r.next_credit_secs !== undefined) setNextCreditSecs(r.next_credit_secs);
      if (r.regen_cap !== undefined) setServerRegenCap(r.regen_cap);
      if (r.regen_paused !== undefined) setRegenPaused(r.regen_paused);
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
      // Staff post free — the guard above already skips them, but the counter
      // was decremented anyway, which is how a host's balance reached zero and
      // took the echo button with it.
      if (!isMod) {
        if (postAnonymously) {
          setAnonCredits(c => c - 1);
        } else {
          setCredits(c => c - 1);
        }
      }
      setMyQuestionIds(prev => new Set([...prev, q.id]));
      // A pending question is not broadcast and is not in the feed, so nothing
      // else will ever put it on the author's screen. Without this it lands
      // nowhere and the page still reads "No questions yet".
      if (q.status === 'pending') setMyPending(prev => [q, ...prev]);
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
    // Staff echo freely — the server already exempts them (it only calls
    // spendCredit when the caller is not elevated), so guarding on a balance
    // here locked hosts out of a thing the API would have allowed. A host who
    // asked six questions ran their counter to zero and lost the echo button.
    if ((!isMod && credits < 1) || echoedIds.has(questionId)) return;
    try {
      const { vote_count } = await api.post<{ vote_count: number }>(
        `/questions/${questionId}/echo`, {},
      );
      // Use the count we were just handed. It used to be discarded and the
      // number only moved when the echo came back over SSE — so on the polling
      // fallback the credit was spent and the total sat unchanged until the
      // next poll. The SSE handler is idempotent, so an echo arriving after
      // this simply sets the same value.
      setQuestions(prev => prev.map(q => (q.id === questionId ? { ...q, vote_count } : q)));
      if (!isMod) setCredits(c => c - 1);
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

  // Spot questions that have just become answered, and hold them briefly.
  //
  // Compares against the previous status rather than the current one, so this
  // fires on the transition and not on load — otherwise every question already
  // answered when the page opened would animate itself out on arrival.
  useEffect(() => {
    const seen = seenStatusRef.current;
    const justAnswered: string[] = [];
    const next = new Map<string, string>();
    for (const q of questions) {
      next.set(q.id, q.status);
      const before = seen.get(q.id);
      if (before && before !== 'answered' && q.status === 'answered') justAnswered.push(q.id);
    }
    seenStatusRef.current = next;
    if (!justAnswered.length) return;

    setLeaving(prev => new Set([...prev, ...justAnswered]));
    // Slightly longer than the 360ms collapse, so the card is unmounted after
    // the animation has finished rather than partway through it.
    const timer = setTimeout(() => {
      setLeaving(prev => {
        const rest = new Set(prev);
        justAnswered.forEach(id => rest.delete(id));
        return rest;
      });
    }, 420);
    return () => clearTimeout(timer);
  }, [questions]);

  const liveOrderedQuestions = [...questions].filter(q => {
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

    // Answered questions leave Top. Top is the queue — what the room still
    // wants asked — and a question the host has already dealt with is no longer
    // that. It kept its place regardless of echoes, so a 0-echo answered
    // question sat in the TOP QUESTION slot above a live one with more, which
    // reads as the ranking being broken.
    //
    // Pinned and spotlighted are the exceptions: both are the host deliberately
    // holding something up, and spotlight in particular means "answering this
    // now" — pulling it out mid-answer would take it off the screen of everyone
    // watching the answer happen.
    //
    // `leaving` holds it for one animation. Dropping it the instant its status
    // changed made the page jolt: the card went in a single frame and the feed
    // snapped up by its whole height, under the eyes of the person who had just
    // been reading it.
    if (sort === 'echoes' && !searchQuery && q.status === 'answered'
        && !(q as any).is_pinned && !(q as any).is_spotlighted
        && !leaving.has(q.id)) return false;
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

  // Recorded every render so the scroll handler can capture the order the
  // viewer was actually looking at when they scrolled away.
  liveOrderRef.current = new Map(liveOrderedQuestions.map((q, i) => [q.id, i]));

  // Frozen: keep the captured order. Anything that arrived since is not in the
  // snapshot and sorts to the end rather than pushing into the middle — it is
  // already announced by the "N new questions" pill, and going back to the top
  // is what asks for the list to settle into its real order. Removals need no
  // handling: a hidden question leaves `questions` and simply is not here.
  const displayedQuestions = frozenOrder
    ? [...liveOrderedQuestions].sort((a, b) =>
        (frozenOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER)
        - (frozenOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    : liveOrderedQuestions;

  const submissionClosed = session?.submission_cutoff_at
    ? new Date() > new Date(session.submission_cutoff_at)
    : session?.status === 'closed';

  const isLiveSoon = session?.status === 'upcoming' && session.starts_at
    && (new Date(session.starts_at).getTime() - Date.now()) < 30 * 60 * 1000;

  if (loading) return <LoadingScreen />;
  if (error && !session) return <ErrorScreen message={error} />;
  if (!session) return null;

  // Separate featured (top) question from the rest
  // Roots only — a follow-up should never be hoisted out of its thread into the
  // featured slot, where it would read as a question with no question before it.
  const featuredQuestion = sort === 'echoes' && !searchQuery
    ? (displayedQuestions.find(q => !q.parent_question_id) ?? null)
    : null;
  // Follow-ups are rendered inside their thread's root card, so they must not
  // also appear as loose entries competing on their own echo count — an active
  // thread would otherwise scatter itself across the feed.
  // A plain function, not a hook: this sits below the loading/error returns, and
  // a useCallback here would be called conditionally.
  const threadReplies = (rootId: string) => questions
    .filter(q => q.parent_question_id && (q.thread_root_id ?? q.parent_question_id) === rootId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const rootQuestions = displayedQuestions.filter(q => !q.parent_question_id);
  // The similar-question panel, with counts read from live state rather than
  // the snapshot fetched when the person started typing. The same question is
  // on screen twice while they type — once in the feed, once in the panel — and
  // the two showing different numbers makes the count look invented.
  const similarWithLiveCounts = similarQuestions.map(q => {
    const live = questions.find(x => x.id === q.id);
    return live ? { ...q, vote_count: live.vote_count } : q;
  });

  const listQuestions = featuredQuestion
    ? rootQuestions.filter(q => q.id !== featuredQuestion.id)
    : rootQuestions;

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
        regenPaused={regenPaused}
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
                <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                  <Link href={`/org/${session.org_slug}`} className="text-xs text-brand-orange/70 hover:text-brand-orange flex items-center gap-1">
                    {session.org_name}
                    {session.org_is_verified && (
                      <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-brand-orange text-white flex-shrink-0">
                        <svg viewBox="0 0 24 24" className="w-1.5 h-1.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                      </span>
                    )}
                  </Link>
                  {/* Someone who came for this show is the likeliest person to
                      want the next one. Offering it here, rather than only on
                      the channel page, is the difference between a listener and
                      a returning audience. */}
                  {session.org_id && (
                    <FollowChannel
                      orgId={session.org_id}
                      initialFollowing={!!session.org_is_following}
                      size="sm"
                    />
                  )}
                </div>
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
                         text-white text-base focus:outline-none focus:border-brand-purple transition-colors"
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
            {/* The caller's own questions waiting for approval. Only they see
                these: the feed hides pending questions from everyone but session
                staff, which used to mean hiding them from their author too. */}
            {myPending.map(q => (
              <PendingQuestionCard
                key={q.id}
                question={q}
                editSecondsLeft={editSecondsLeft(q)}
                onEditSave={(body) => editQuestion(q.id, body)}
              />
            ))}

            {featuredQuestion && (
              <Collapsible leaving={leaving.has(featuredQuestion.id)}>
              <FeaturedQuestionCard
                /* Keyed, and it matters more here than in a list. This slot
                   holds whichever root currently leads on echoes, so a question
                   arriving mid-session can swap the occupant underneath the
                   viewer. Without a key React kept the same instance and only
                   changed the props, so every bit of local state inside carried
                   over to a different question: an open follow-up composer
                   stayed open — now posting to the new occupant — and
                   useInlineEdit's draft, seeded from question.body on mount
                   only, still held the previous question's text, so saving an
                   edit wrote the old body onto the new question. */
                key={featuredQuestion.id}
                question={featuredQuestion}
                isEchoed={echoedIds.has(featuredQuestion.id)}
                isMine={myQuestionIds.has(featuredQuestion.id)}
                canAffordEcho={isMod || credits > 0}
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
                editSecondsLeft={editSecondsLeft(featuredQuestion)}
                onEditSave={(body) => editQuestion(featuredQuestion.id, body)}
                canFollowUp={canFollowUp(featuredQuestion)}
                onFollowUp={(body) => askFollowUp(featuredQuestion.id, body)}
                replies={threadReplies(featuredQuestion.id)}
              />
              </Collapsible>
            )}

            {/* Remaining questions */}
            {listQuestions.length === 0 && !featuredQuestion && myPending.length === 0 && (
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
              <Collapsible key={q.id} leaving={leaving.has(q.id)}>
              <QuestionCard
                key={q.id}
                question={q}
                isEchoed={echoedIds.has(q.id)}
                isMine={myQuestionIds.has(q.id)}
                canAffordEcho={isMod || credits > 0}
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
                editSecondsLeft={editSecondsLeft(q)}
                onEditSave={(body) => editQuestion(q.id, body)}
                canFollowUp={canFollowUp(q)}
                onFollowUp={(body) => askFollowUp(q.id, body)}
                replies={threadReplies(q.id)}
              />
              </Collapsible>
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
                      <p className="text-[11px] text-brand-orange mt-0.5">{plural(q.vote_count, 'echo', 'echoes')}</p>
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
                        <p className="text-[11px] text-purple-200/70">{plural(p.echoes, 'echo', 'echoes')} received</p>
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
          similarQuestions={similarWithLiveCounts}
          echoedIds={echoedIds}
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
            // Released here as well as in the scroll handler. The smooth scroll
            // settles a moment later, and tapping this is an explicit ask to
            // see the list as it actually stands now.
            setFrozenOrder(null);
          }}
          className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-40
                     bg-brand-purple text-white text-sm font-bold
                     px-5 py-3 rounded-full shadow-xl border border-brand-purple/60
                     hover:bg-brand-purple/90 transition-colors flex items-center gap-1.5 min-h-[44px]"
        >
          ↑ {plural(newQuestionsCount, 'new question')}
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
