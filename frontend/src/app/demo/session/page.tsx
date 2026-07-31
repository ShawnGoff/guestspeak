'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type Q = {
  id: number;
  text: string;
  echoes: number;
  echoed: boolean;
  answered: boolean;
  pinned: boolean;
  author: string;
  authorColor: string;
  ago: string;
  tags: string[];
  comments: number;
  ts: number;
  supporters?: string[];
};

type ActivityItem = {
  id: number;
  text: string;
  time: string;
  kind: 'echo' | 'question' | 'answer' | 'move' | 'host';
};

type Participant = {
  name: string;
  color: string;
  echoes: number;
};

// ─── Seed Data ────────────────────────────────────────────────────────────────

const BASE_TS = Date.now();

const SEED: Q[] = [
  {
    id: 1,
    text: 'Will we be adopting AI-native tooling across the full design sprint process?',
    echoes: 92, echoed: false, answered: false, pinned: true,
    author: 'curious_dev_91', authorColor: '#7C3AED',
    ago: '2m ago', tags: ['Tools', 'Process', 'AI Strategy'], comments: 12,
    ts: BASE_TS - 120000,
    supporters: ['design_thinker_77', 'luma_builds', 'syntax_seeker', 'metric_mind_33'],
  },
  {
    id: 2,
    text: "What's the roadmap for integrating AI into our component library workflows?",
    echoes: 48, echoed: false, answered: false, pinned: false,
    author: 'design_thinker_77', authorColor: '#059669',
    ago: '4m ago', tags: ['Roadmap', 'Engineering'], comments: 12,
    ts: BASE_TS - 240000,
  },
  {
    id: 3,
    text: 'How are we thinking about AI-generated content vs. human creative direction?',
    echoes: 36, echoed: false, answered: false, pinned: false,
    author: 'luma_builds', authorColor: '#DC2626',
    ago: '5m ago', tags: ['Content', 'Strategy', 'AI Ethics'], comments: 8,
    ts: BASE_TS - 300000,
  },
  {
    id: 4,
    text: 'Are there plans to provide AI tooling training specifically for the front-end team?',
    echoes: 29, echoed: false, answered: false, pinned: false,
    author: 'syntax_seeker', authorColor: '#D97706',
    ago: '7m ago', tags: ['Training', 'Front-end', 'Tools'], comments: 6,
    ts: BASE_TS - 420000,
  },
  {
    id: 5,
    text: 'What metrics are we using to evaluate AI productivity gains across teams?',
    echoes: 115, echoed: false, answered: true, pinned: false,
    author: 'metric_mind_33', authorColor: '#2563EB',
    ago: '9m ago', tags: ['Metrics', 'Productivity'], comments: 4,
    ts: BASE_TS - 540000,
  },
  {
    id: 6,
    text: 'Will design tokens and theme variables ever be AI-generated?',
    echoes: 8, echoed: false, answered: true, pinned: false,
    author: 'token_engineer', authorColor: '#7C3AED',
    ago: '12m ago', tags: ['Design System', 'Tokens', 'AI'], comments: 3,
    ts: BASE_TS - 720000,
  },
  {
    id: 7,
    text: 'How do we handle attribution for AI-assisted work in our portfolios?',
    echoes: 3, echoed: false, answered: false, pinned: false,
    author: 'credit_curious', authorColor: '#DC2626',
    ago: '14m ago', tags: ['AI Ethics', 'Attribution'], comments: 2,
    ts: BASE_TS - 840000,
  },
];

const INIT_ACTIVITY: ActivityItem[] = [
  { id: 1, kind: 'echo',     text: '+3 echoes for the top question',        time: 'just now' },
  { id: 2, kind: 'question', text: 'luma_builds asked a question',           time: 'just now' },
  { id: 3, kind: 'echo',     text: 'design_thinker_77 echoed a question',    time: 'just now' },
  { id: 4, kind: 'move',     text: 'Question moved up the feed',             time: 'just now' },
  { id: 5, kind: 'host',     text: 'Host is answering a question',           time: 'just now' },
];

const ACTIVITY_POOL: Pick<ActivityItem, 'kind' | 'text'>[] = [
  { kind: 'echo',     text: 'syntax_seeker echoed a question' },
  { kind: 'question', text: 'new_arrival_52 asked a question' },
  { kind: 'echo',     text: '+2 echoes for question #3' },
  { kind: 'move',     text: 'Question moved up the feed' },
  { kind: 'echo',     text: 'credit_curious echoed the top question' },
  { kind: 'host',     text: 'Host pinned a new question' },
  { kind: 'echo',     text: '+4 echoes in the last minute' },
  { kind: 'question', text: 'stellar_wave_88 asked a question' },
];

const PARTICIPANTS: Participant[] = [
  { name: 'design_thinker_77', color: '#059669', echoes: 24 },
  { name: 'curious_dev_91',    color: '#7C3AED', echoes: 18 },
  { name: 'luma_builds',       color: '#DC2626', echoes: 15 },
  { name: 'syntax_seeker',     color: '#D97706', echoes: 11 },
  { name: 'metric_mind_33',    color: '#2563EB', echoes: 9  },
];

const ACTIVITY_STYLES: Record<ActivityItem['kind'], { bg: string; color: string; icon: string }> = {
  echo:     { bg: 'rgba(245,146,30,0.15)',  color: '#F5921E', icon: '↑' },
  question: { bg: 'rgba(124,58,237,0.15)',  color: '#A78BFA', icon: '?' },
  answer:   { bg: 'rgba(16,185,129,0.15)',  color: '#34D399', icon: '✓' },
  move:     { bg: 'rgba(16,185,129,0.15)',  color: '#34D399', icon: '↑' },
  host:     { bg: 'rgba(245,146,30,0.15)',  color: '#F5921E', icon: '🎤' },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name, color, size = 'sm' }: { name: string; color: string; size?: 'xs' | 'sm' }) {
  const cls = { xs: 'w-5 h-5 text-[9px]', sm: 'w-6 h-6 text-[10px]' };
  return (
    <div
      className={`${cls[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ backgroundColor: color }}
    >
      {name[0].toUpperCase()}
    </div>
  );
}

function TagPill({ label }: { label: string }) {
  return (
    <span className="text-[11px] text-white/45 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full whitespace-nowrap">
      {label}
    </span>
  );
}

// ─── Question Cards ───────────────────────────────────────────────────────────

function TopQuestionCard({
  q, view, isNew, showFlash, onEcho, onPin, onAnswer,
}: {
  q: Q; view: 'audience' | 'host'; isNew?: boolean; showFlash?: boolean;
  onEcho(): void; onPin(): void; onAnswer(): void;
}) {
  return (
    <div className={`rounded-2xl border border-brand-orange/60 bg-brand-card p-5 shadow-orange-glow ${isNew ? 'animate-fade-up' : ''}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-bold text-brand-orange tracking-wide">🔥 TOP QUESTION</span>
        {view === 'host' && (
          <div className="ml-auto flex gap-2">
            <button onClick={onPin} className="text-xs px-2.5 py-1 rounded-lg border border-brand-orange/40 text-brand-orange hover:bg-brand-orange/10 transition-all">
              {q.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button onClick={onAnswer} className="text-xs px-2.5 py-1 rounded-lg border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-all">
              {q.answered ? 'Reopen' : 'Mark answered'}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-4 sm:gap-6">
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg font-bold leading-snug mb-3">{q.text}</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {q.tags.map(t => <TagPill key={t} label={t} />)}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Avatar name={q.author} color={q.authorColor} size="xs" />
            <span className="font-medium text-white/60">{q.author}</span>
            <span>·</span>
            <span>{q.ago}</span>
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-center gap-3 min-w-[72px]">
          <div className="relative w-full">
            {showFlash && (
              <span
                className="absolute -top-5 left-1/2 text-xs font-bold text-brand-amber pointer-events-none"
                style={{ animation: 'floatUp 0.65s ease-out forwards' }}
              >
                +1
              </span>
            )}
            <button
              onClick={onEcho}
              disabled={q.echoed}
              className={`w-full flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition-all duration-150 active:scale-95 ${
                q.echoed
                  ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                  : 'border-brand-border text-white/50 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
              }`}
            >
              <span className="text-xl font-black leading-none">↑</span>
              <span className="text-2xl font-black leading-none">{q.echoes}</span>
              <span className="text-[10px] font-semibold tracking-wide opacity-60">echoes</span>
            </button>
          </div>

          {q.supporters && (
            <div className="flex -space-x-1.5">
              {q.supporters.slice(0, 4).map((s, i) => (
                <div
                  key={i}
                  className="w-5 h-5 rounded-full border-2 border-brand-bg flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ backgroundColor: PARTICIPANTS.find(p => p.name === s)?.color ?? '#7C3AED' }}
                >
                  {s[0].toUpperCase()}
                </div>
              ))}
              <div className="w-5 h-5 rounded-full border-2 border-brand-bg bg-brand-border text-white/40 text-[8px] flex items-center justify-center font-semibold">
                +38
              </div>
            </div>
          )}

          <button className="text-[11px] text-white/30 hover:text-white/60 transition-colors">
            ↗ Share
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q, view, isNew, showFlash, onEcho, onPin, onAnswer,
}: {
  q: Q; view: 'audience' | 'host'; isNew?: boolean; showFlash?: boolean;
  onEcho(): void; onPin(): void; onAnswer(): void;
}) {
  return (
    <div
      className={`flex gap-3 rounded-2xl border bg-brand-card p-4 transition-all duration-200 ${
        q.answered ? 'border-brand-border/40 opacity-55' : 'border-brand-border hover:border-brand-border/80'
      } ${isNew ? 'animate-fade-up' : ''}`}
    >
      <div className="shrink-0 flex flex-col items-center w-10 relative">
        {showFlash && (
          <span
            className="absolute -top-4 left-1/2 text-xs font-bold text-brand-amber pointer-events-none"
            style={{ animation: 'floatUp 0.65s ease-out forwards' }}
          >
            +1
          </span>
        )}
        {q.answered ? (
          <div className="flex flex-col items-center gap-0.5 text-green-400 pt-1">
            <span className="text-lg font-bold leading-none">✓</span>
            <span className="text-sm font-bold">{q.echoes}</span>
          </div>
        ) : (
          <button
            onClick={onEcho}
            disabled={q.echoed}
            className={`flex flex-col items-center gap-0.5 w-full py-2 rounded-xl transition-all active:scale-95 ${
              q.echoed ? 'text-brand-amber' : 'text-white/35 hover:text-brand-orange'
            }`}
          >
            <span className="text-lg font-black leading-none">↑</span>
            <span className="text-sm font-bold">{q.echoes}</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm sm:text-[15px] leading-relaxed mb-2">{q.text}</p>
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {q.tags.map(t => <TagPill key={t} label={t} />)}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-white/35">
            <Avatar name={q.author} color={q.authorColor} size="xs" />
            <span>{q.author}</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-white/30 shrink-0 flex-wrap">
            {q.answered && (
              <span className="text-[11px] font-bold text-green-400 bg-green-500/10 border border-green-500/25 px-2 py-0.5 rounded-full">
                ✓ ANSWERED
              </span>
            )}
            <span>{q.ago}</span>
            <span>💬 {q.comments}</span>
            {view === 'host' && (
              <div className="flex gap-1.5">
                <button
                  onClick={onPin}
                  className="px-2 py-0.5 rounded border border-brand-border text-white/35 hover:border-brand-orange/40 hover:text-brand-orange transition-all"
                >
                  Pin
                </button>
                <button
                  onClick={onAnswer}
                  className={`px-2 py-0.5 rounded border transition-all ${
                    q.answered
                      ? 'border-green-500/40 text-green-400 hover:border-red-500/40 hover:text-red-400'
                      : 'border-brand-border text-white/35 hover:border-green-500/40 hover:text-green-400'
                  }`}
                >
                  {q.answered ? 'Reopen' : 'Answered'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page (inner, reads search params) ───────────────────────────────────

function SessionPageInner() {
  const params = useSearchParams();
  const titleParam  = params.get('title') ?? 'AI in Product Development';
  const isHostParam = params.get('host') === 'true';
  const creditsParam = Number(params.get('credits') ?? 3);

  const [qs, setQs]             = useState<Q[]>(SEED);
  const [sort, setSort]         = useState<'top' | 'rising' | 'newest' | 'answered'>('top');
  const [view, setView]         = useState<'audience' | 'host'>(isHostParam ? 'host' : 'audience');
  const [draft, setDraft]       = useState('');
  const [isAnon, setIsAnon]     = useState(false);
  const [credits, setCredits]   = useState(creditsParam);
  const [submitted, setSubmitted] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>(INIT_ACTIVITY);
  const [actNextId, setActNextId] = useState(100);
  const [attending, setAttending] = useState(143);
  const [newCount, setNewCount] = useState(7);
  const [newIds, setNewIds]     = useState<Set<number>>(new Set());
  const [echoFlash, setEchoFlash] = useState<Record<number, boolean>>({});
  const guestName = 'stellar_wave_88';

  useEffect(() => {
    const t = setInterval(() => {
      if (Math.random() > 0.5) setAttending(n => n + 1);
      if (Math.random() > 0.6) setNewCount(n => n + 1);
    }, 5500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setQs(prev => {
        const eligible = prev.filter(q => !q.answered && q.id < 90);
        if (!eligible.length) return prev;
        const target = eligible[Math.floor(Math.random() * eligible.length)];
        return prev.map(q => q.id === target.id ? { ...q, echoes: q.echoes + 1 } : q);
      });
    }, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const evt = ACTIVITY_POOL[Math.floor(Math.random() * ACTIVITY_POOL.length)];
      setActNextId(id => {
        const next = id + 1;
        setActivity(prev => [
          { id: next, kind: evt.kind, text: evt.text, time: 'just now' },
          ...prev.slice(0, 5),
        ]);
        return next;
      });
    }, 3200);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const newQ: Q = {
        id: 99,
        text: 'Can we see a live demo of AI tools being used in the current sprint right now?',
        echoes: 0, echoed: false, answered: false, pinned: false,
        author: 'new_arrival_52', authorColor: '#0891B2',
        ago: 'just now', tags: ['AI', 'Live Demo'], comments: 0, ts: Date.now(),
      };
      setQs(prev => prev.some(x => x.id === 99) ? prev : [...prev, newQ]);
      setNewIds(prev => new Set([...prev, 99]));
      setActivity(prev => [
        { id: 998, kind: 'question', text: 'new_arrival_52 asked a question', time: 'just now' },
        ...prev.slice(0, 5),
      ]);
    }, 9000);
    return () => clearTimeout(t);
  }, []);

  function echo(id: number) {
    setQs(prev => prev.map(q => q.id === id && !q.echoed ? { ...q, echoes: q.echoes + 1, echoed: true } : q));
    setEchoFlash(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setEchoFlash(prev => ({ ...prev, [id]: false })), 650);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || credits === 0) return;
    const id = Date.now();
    setQs(prev => [...prev, {
      id, text, echoes: 0, echoed: false, answered: false, pinned: false,
      author: isAnon ? 'anonymous' : guestName, authorColor: '#0891B2',
      ago: 'just now', tags: [], comments: 0, ts: Date.now(),
    }]);
    setNewIds(prev => new Set([...prev, id]));
    setDraft('');
    setCredits(c => c - 1);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
    setActivity(prev => [
      { id: actNextId + 1, kind: 'question', text: `${isAnon ? 'Someone' : guestName} asked a question`, time: 'just now' },
      ...prev.slice(0, 5),
    ]);
  }

  function togglePin(id: number) {
    setQs(prev => prev.map(q => q.id === id ? { ...q, pinned: !q.pinned } : { ...q, pinned: false }));
  }

  function toggleAnswer(id: number) {
    setQs(prev => prev.map(q => q.id === id ? { ...q, answered: !q.answered } : q));
  }

  const allSorted = [...qs].sort((a, b) => {
    if (sort === 'newest')  return b.ts - a.ts;
    if (sort === 'rising')  return (b.echoes / ((BASE_TS - b.ts) / 60000 + 2)) - (a.echoes / ((BASE_TS - a.ts) / 60000 + 2));
    return b.echoes - a.echoes;
  });

  const unanswered   = allSorted.filter(q => !q.answered);
  const answeredList = allSorted.filter(q => q.answered);
  const featuredQ    = sort === 'answered' ? null : unanswered[0] ?? null;
  const listQs       = sort === 'answered' ? answeredList : [...unanswered.slice(1), ...answeredList];

  const totalAsked  = qs.length;
  const awaitingAns = qs.filter(q => !q.answered).length;
  const answeredCnt = qs.filter(q => q.answered).length;

  return (
    <>
      <style>{`
        @keyframes floatUp {
          from { opacity: 1; transform: translateY(0) translateX(-50%); }
          to   { opacity: 0; transform: translateY(-22px) translateX(-50%); }
        }
      `}</style>

      <div className="min-h-screen lg:h-screen bg-brand-bg text-white font-sans flex flex-col">

        {/* Header */}
        <header className="border-b border-brand-border bg-brand-bg/95 backdrop-blur shrink-0 z-20 sticky top-0">
          <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
            <Link
              href="/demo"
              className="text-white/35 hover:text-white/70 transition-colors text-sm font-medium flex items-center gap-1 shrink-0"
            >
              ← Discover
            </Link>
            <span className="text-brand-border/40 shrink-0">/</span>
            <Link href="/" className="font-display text-lg font-bold shrink-0">
              Guest<span className="text-brand-orange">Speak</span>
            </Link>
            <span className="text-[10px] font-bold text-brand-orange/60 bg-brand-orange/10 border border-brand-orange/20 px-1.5 py-0.5 rounded-full tracking-wider shrink-0">
              DEMO
            </span>

            <div className="hidden sm:flex items-center gap-2.5 mx-auto">
              <span className="badge-live">Live</span>
              <h1 className="font-display font-bold text-base sm:text-lg truncate max-w-xs">{titleParam}</h1>
            </div>

            <div className="flex items-center gap-3 ml-auto shrink-0">
              <div className="hidden md:flex items-center gap-4 text-sm text-white/50">
                <span>
                  <span className="text-brand-amber font-bold">{attending}</span>
                  <span className="ml-1">attendees</span>
                </span>
                <span className="text-brand-orange font-semibold">+{newCount} new</span>
              </div>
              <div className="flex bg-brand-card border border-brand-border rounded-lg overflow-hidden text-sm">
                <button
                  onClick={() => setView('audience')}
                  className={`px-3 sm:px-4 py-1.5 font-semibold transition-all ${
                    view === 'audience' ? 'bg-brand-orange text-brand-bg' : 'text-white/50 hover:text-white'
                  }`}
                >
                  Audience
                </button>
                <button
                  onClick={() => setView('host')}
                  className={`px-3 sm:px-4 py-1.5 font-semibold transition-all ${
                    view === 'host' ? 'bg-brand-orange text-brand-bg' : 'text-white/50 hover:text-white'
                  }`}
                >
                  🎤 Host
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 lg:overflow-hidden">

          {/* Left Sidebar */}
          <aside className="hidden lg:flex flex-col w-52 xl:w-56 border-r border-brand-border shrink-0 overflow-y-auto">
            <div className="p-4 flex flex-col gap-5 h-full">
              <div>
                <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3">📋 Event</p>
                <h2 className="font-display font-bold text-[15px] leading-snug mb-1">{titleParam}</h2>
                <p className="text-xs text-white/40 mb-1">Design &amp; Engineering All Hands</p>
                <p className="text-xs text-white/35">
                  Hosted by <span className="text-brand-amber font-semibold">Shawn G.</span>
                </p>
              </div>

              <div className="flex flex-col gap-2 text-xs text-white/40">
                <span className="flex items-center gap-2">📅 May 24, 2025</span>
                <span className="flex items-center gap-2">⏱ 45 mins remaining</span>
                <span className="flex items-center gap-2">📍 Virtual Event</span>
              </div>

              <div className="border-t border-brand-border/40 pt-4 flex flex-col gap-3">
                {[
                  { label: 'Questions asked', value: totalAsked },
                  { label: 'Awaiting answer',  value: awaitingAns },
                  { label: 'Answered',          value: answeredCnt },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-xs text-white/35">{s.label}</span>
                    <span className="text-lg font-bold">{s.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto border-t border-brand-border/40 pt-4">
                <div className="rounded-xl bg-brand-purple/15 border border-brand-purple/25 p-3.5 text-center">
                  <p className="text-xs font-bold text-white/60 mb-1">Join the conversation</p>
                  <p className="text-[11px] text-white/30 mb-3">Ask a question or echo your favorites!</p>
                  <div className="bg-brand-bg rounded-lg px-3 py-2 mb-3">
                    <p className="text-[10px] text-white/25 mb-0.5">Join code</p>
                    <p className="text-base font-bold text-brand-amber tracking-[0.2em]">GS-7XK</p>
                  </div>
                  <p className="text-xs text-brand-orange font-semibold">guestspeak.app</p>
                </div>
              </div>
            </div>
          </aside>

          {/* Center Feed */}
          <main className="flex-1 min-w-0 lg:overflow-y-auto flex flex-col">
            <div className="flex items-center border-b border-brand-border sticky top-[57px] lg:top-0 bg-brand-bg z-10 px-3 sm:px-5 overflow-x-auto gap-0">
              {[
                { id: 'top',      label: '🔥 Top' },
                { id: 'rising',   label: '📈 Rising' },
                { id: 'newest',   label: '🕐 Newest' },
                { id: 'answered', label: '✓ Answered' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setSort(t.id as typeof sort)}
                  className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${
                    sort === t.id
                      ? 'border-brand-orange text-white'
                      : 'border-transparent text-white/35 hover:text-white/70'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {view === 'audience' && (
                <button
                  onClick={() => document.getElementById('ask-input')?.focus()}
                  className="ml-auto flex items-center gap-1.5 bg-orange-gradient text-white font-bold text-xs sm:text-sm px-3 sm:px-4 py-1.5 rounded-lg shadow-orange-glow hover:brightness-110 transition-all my-2 shrink-0"
                >
                  ✏️ Ask a question
                </button>
              )}
            </div>

            <div className="p-4 sm:p-5 flex flex-col gap-3 pb-28 lg:pb-6">
              {featuredQ && (
                <TopQuestionCard
                  q={featuredQ}
                  view={view}
                  isNew={newIds.has(featuredQ.id)}
                  showFlash={!!echoFlash[featuredQ.id]}
                  onEcho={() => echo(featuredQ.id)}
                  onPin={() => togglePin(featuredQ.id)}
                  onAnswer={() => toggleAnswer(featuredQ.id)}
                />
              )}

              {sort === 'answered' && answeredList.length === 0 && (
                <div className="text-center py-16 text-white/25 text-sm">No answered questions yet</div>
              )}

              {listQs.map(q => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  view={view}
                  isNew={newIds.has(q.id)}
                  showFlash={!!echoFlash[q.id]}
                  onEcho={() => echo(q.id)}
                  onPin={() => togglePin(q.id)}
                  onAnswer={() => toggleAnswer(q.id)}
                />
              ))}
            </div>
          </main>

          {/* Right Sidebar */}
          <aside className="hidden xl:flex flex-col w-[272px] border-l border-brand-border shrink-0 overflow-y-auto">
            <div className="p-4 border-b border-brand-border/40">
              <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3">📊 Live Activity</p>
              <div className="flex flex-col gap-2.5">
                {activity.map(a => {
                  const s = ACTIVITY_STYLES[a.kind];
                  return (
                    <div key={a.id} className="flex items-start gap-2.5 text-xs">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold"
                        style={{ background: s.bg, color: s.color }}
                      >
                        {s.icon}
                      </div>
                      <div className="flex-1 min-w-0 leading-relaxed">
                        <span className="text-white/55">{a.text}</span>
                        <span className="text-white/20 ml-1">· {a.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button className="mt-3 text-xs text-brand-orange/70 hover:text-brand-orange transition-colors flex items-center gap-1">
                View all activity <span className="text-white/25">›</span>
              </button>
            </div>

            <div className="p-4">
              <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3">🏆 Top Participants</p>
              <div className="flex flex-col gap-3">
                {PARTICIPANTS.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span className={`text-xs font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-brand-amber' : 'text-white/25'}`}>
                      {i + 1}
                    </span>
                    <Avatar name={p.name} color={p.color} size="xs" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/70 truncate">{p.name}</p>
                      <p className="text-[11px] text-white/30">{p.echoes} echoes</p>
                    </div>
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? 'bg-brand-amber/20 text-brand-amber' : 'bg-white/5 text-white/35'
                      }`}
                    >
                      {p.echoes}
                    </div>
                  </div>
                ))}
              </div>
              <button className="mt-4 text-xs text-brand-orange/70 hover:text-brand-orange transition-colors flex items-center gap-1">
                See full leaderboard <span className="text-white/25">›</span>
              </button>
            </div>
          </aside>
        </div>

        {/* Bottom Ask Bar */}
        <div className="border-t border-brand-border bg-brand-bg/95 backdrop-blur shrink-0 z-20 sticky bottom-0 lg:relative">
          {view === 'audience' ? (
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
              <div className="hidden sm:block shrink-0">
                <p className="text-xs font-bold text-white/60">Ask a question</p>
                <p className="text-[11px] text-white/25">Get it answered by the host</p>
              </div>

              {submitted ? (
                <div className="flex-1 py-2 text-center text-sm text-green-400 font-semibold animate-fade-up">
                  ✓ Question submitted — others can echo it now
                </div>
              ) : credits === 0 ? (
                <div className="flex-1 py-2 text-center text-sm text-white/25">
                  You&apos;ve used all your questions for this session
                </div>
              ) : (
                <form onSubmit={submit} className="flex-1 flex items-center gap-2">
                  <input
                    id="ask-input"
                    className="input text-sm !py-2.5 flex-1"
                    placeholder="Type your question here..."
                    value={draft}
                    onChange={e => setDraft(e.target.value.slice(0, 300))}
                  />
                  <button
                    type="button"
                    onClick={() => setIsAnon(v => !v)}
                    className={`hidden sm:block shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border transition-all ${
                      isAnon
                        ? 'border-brand-purple/60 text-brand-purple-light bg-brand-purple/10'
                        : 'border-brand-border text-white/35 hover:border-white/20'
                    }`}
                  >
                    {isAnon ? '🙈 Anon' : 'Anonymous'}
                  </button>
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      draft.trim()
                        ? 'bg-orange-gradient text-white shadow-orange-glow hover:brightness-110 active:scale-95'
                        : 'bg-brand-card border border-brand-border text-white/20 cursor-default'
                    }`}
                  >
                    ↑ Submit question
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 text-sm">
              <span className="font-semibold text-brand-amber">🎤 Host view</span>
              <span className="text-white/30 hidden sm:inline">
                — Pin questions, mark answered, manage the feed
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Page (wrapped in Suspense for useSearchParams) ───────────────────────────

export default function SessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-bg" />}>
      <SessionPageInner />
    </Suspense>
  );
}
