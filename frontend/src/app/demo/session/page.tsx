'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

type Q = {
  id: number;
  text: string;
  echoes: number;
  echoed: boolean;
  answered: boolean;
  starred: boolean;
  author: string;
  authorColor: string;
  ago: string;
  ts: number;
  host_reply?: string;
  supporters?: string[];
};

type Participant = {
  name: string;
  color: string;
  echoes: number;
};

// ─── Seed Data ────────────────────────────────────────────────────────────────

const BASE_TS = Date.now();

const SEED_MUSIC: Q[] = [
  {
    id: 1,
    text: "What's the story behind the title track — it feels way more personal than anything you've released before?",
    echoes: 129, echoed: false, answered: false, starred: true,
    author: 'superfan_sadie', authorColor: '#7C3AED',
    ago: '2m ago', ts: BASE_TS - 120000,
    supporters: ['record_collector', 'backstage_beats', 'melody_chaser', 'vinyl_vibes'],
  },
  {
    id: 2,
    text: "Which collab on this record surprised you the most — and how did it come together?",
    echoes: 87, echoed: false, answered: false, starred: false,
    author: 'record_collector', authorColor: '#059669',
    ago: '4m ago', ts: BASE_TS - 240000,
  },
  {
    id: 3,
    text: "There's a lyric in track 4 that feels like it's about a specific moment. Are you ever nervous about how specific you get?",
    echoes: 65, echoed: false, answered: false, starred: false,
    author: 'anon', authorColor: '#DC2626',
    ago: '6m ago', ts: BASE_TS - 360000,
  },
  {
    id: 4,
    text: "How do you decide what makes the final cut vs what stays in the vault?",
    echoes: 44, echoed: false, answered: false, starred: false,
    author: 'backstage_beats', authorColor: '#D97706',
    ago: '8m ago', ts: BASE_TS - 480000,
  },
  {
    id: 5,
    text: "Which song from this album are you most excited to finally play live?",
    echoes: 108, echoed: false, answered: true, starred: false,
    author: 'melody_chaser', authorColor: '#2563EB',
    ago: '10m ago', ts: BASE_TS - 600000,
    host_reply: "Honestly? “Signal Fire” — we've never played it live and I can't wait to see how the room reacts.",
  },
  {
    id: 6,
    text: "Do you write to a beat or melody first, or does it change every time?",
    echoes: 31, echoed: false, answered: false, starred: false,
    author: 'vinyl_vibes', authorColor: '#0891B2',
    ago: '13m ago', ts: BASE_TS - 780000,
  },
  {
    id: 7,
    text: "Will the vault tracks ever see the light of day — or are some locked forever?",
    echoes: 19, echoed: false, answered: true, starred: false,
    author: 'midnight_listener', authorColor: '#7C3AED',
    ago: '15m ago', ts: BASE_TS - 900000,
    host_reply: "Some will. There's one from the Raven sessions I've been sitting on for three years — this might finally be its moment.",
  },
];

const SEED_NBA: Q[] = [
  {
    id: 1,
    text: 'What adjustments did you make at halftime that turned the game around tonight?',
    echoes: 87, echoed: false, answered: false, starred: true,
    author: 'courtside_kai', authorColor: '#DC2626',
    ago: '2m ago', ts: BASE_TS - 120000,
    supporters: ['hoop_dreams_4', 'lakeshow_liv', 'the_stat_line', 'bench_mob_77'],
  },
  {
    id: 2,
    text: "How do you manage player minutes when the schedule gets brutal — 4 games in 6 nights?",
    echoes: 54, echoed: false, answered: false, starred: false,
    author: 'hoop_dreams_4', authorColor: '#059669',
    ago: '4m ago', ts: BASE_TS - 240000,
  },
  {
    id: 3,
    text: "What's your philosophy on developing young talent vs. playing to win right now?",
    echoes: 41, echoed: false, answered: false, starred: false,
    author: 'lakeshow_liv', authorColor: '#7C3AED',
    ago: '5m ago', ts: BASE_TS - 300000,
  },
  {
    id: 4,
    text: "How involved are you in trade deadline conversations with the front office?",
    echoes: 33, echoed: false, answered: false, starred: false,
    author: 'the_stat_line', authorColor: '#D97706',
    ago: '8m ago', ts: BASE_TS - 480000,
  },
  {
    id: 5,
    text: "What does your film room process look like — how far ahead do you prep for opponents?",
    echoes: 98, echoed: false, answered: true, starred: false,
    author: 'bench_mob_77', authorColor: '#2563EB',
    ago: '10m ago', ts: BASE_TS - 600000,
    host_reply: "We usually start the opponent's tendencies two days out. By game day I want every guy knowing the pick-and-roll coverage cold.",
  },
  {
    id: 6,
    text: "How do you keep veteran players bought in when their roles change late in their careers?",
    echoes: 19, echoed: false, answered: false, starred: false,
    author: 'paint_and_pick', authorColor: '#0891B2',
    ago: '13m ago', ts: BASE_TS - 780000,
  },
];

const SEED_STARTUP: Q[] = [
  {
    id: 1,
    text: "What's your biggest differentiator and why hasn't a larger player built this already?",
    echoes: 74, echoed: false, answered: false, starred: true,
    author: 'venture_vince', authorColor: '#7C3AED',
    ago: '2m ago', ts: BASE_TS - 120000,
    supporters: ['founding_vibes', 'seed_round_sue', 'angel_alicia', 'cap_table_cal'],
  },
  {
    id: 2,
    text: "How did you validate demand before writing a single line of code?",
    echoes: 61, echoed: false, answered: false, starred: false,
    author: 'founding_vibes', authorColor: '#059669',
    ago: '3m ago', ts: BASE_TS - 180000,
  },
  {
    id: 3,
    text: "What does your path to profitability look like and what's your runway right now?",
    echoes: 39, echoed: false, answered: false, starred: false,
    author: 'seed_round_sue', authorColor: '#DC2626',
    ago: '6m ago', ts: BASE_TS - 360000,
  },
  {
    id: 4,
    text: "Are you going enterprise or consumer first — and why?",
    echoes: 28, echoed: false, answered: false, starred: false,
    author: 'angel_alicia', authorColor: '#D97706',
    ago: '8m ago', ts: BASE_TS - 480000,
  },
  {
    id: 5,
    text: "What's your fundraising plan after today — Seed extension or straight to Series A?",
    echoes: 103, echoed: false, answered: true, starred: false,
    author: 'cap_table_cal', authorColor: '#2563EB',
    ago: '11m ago', ts: BASE_TS - 660000,
    host_reply: "We're heads-down on a seed extension right now — want to hit two more proof points before we go out for A.",
  },
  {
    id: 6,
    text: "How are you thinking about hiring — when do you bring on your first non-technical role?",
    echoes: 12, echoed: false, answered: false, starred: false,
    author: 'operator_opal', authorColor: '#0891B2',
    ago: '14m ago', ts: BASE_TS - 840000,
  },
];

function getSeed(title: string): Q[] {
  const t = title.toLowerCase();
  if (t.includes('coach') || t.includes('nba') || t.includes('playoff') || t.includes('pulse')) return SEED_NBA;
  if (t.includes('startup') || t.includes('demo day') || t.includes('pitch') || t.includes('founder')) return SEED_STARTUP;
  return SEED_MUSIC;
}

function getAutoQ(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('coach') || t.includes('nba') || t.includes('playoff') || t.includes('pulse'))
    return 'Which young player on your roster has surprised you the most this season?';
  if (t.includes('startup') || t.includes('demo day') || t.includes('pitch') || t.includes('founder'))
    return "What's the one metric you obsess over above all others right now?";
  return "Is there a song that almost didn't make the album that you're now really glad is on it?";
}


// Static color lookup for known seed authors (used for supporter avatars)
const AUTHOR_COLORS: Record<string, string> = {
  'superfan_sadie':    '#7C3AED',
  'record_collector':  '#059669',
  'backstage_beats':   '#DC2626',
  'melody_chaser':     '#D97706',
  'vinyl_vibes':       '#2563EB',
  'midnight_listener': '#7C3AED',
  'anon':              '#6B7280',
  // NBA
  'courtside_kai':     '#DC2626',
  'hoop_dreams_4':     '#059669',
  'lakeshow_liv':      '#7C3AED',
  'the_stat_line':     '#D97706',
  'bench_mob_77':      '#2563EB',
  'paint_and_pick':    '#0891B2',
  // Startup
  'venture_vince':     '#7C3AED',
  'founding_vibes':    '#059669',
  'seed_round_sue':    '#DC2626',
  'angel_alicia':      '#D97706',
  'cap_table_cal':     '#2563EB',
  'operator_opal':     '#0891B2',
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

// ─── Question Cards ───────────────────────────────────────────────────────────

function TopQuestionCard({
  q, view, isNew, showFlash, noCredits, onEcho, onStar, onAnswer,
}: {
  q: Q; view: 'audience' | 'host'; isNew?: boolean; showFlash?: boolean; noCredits?: boolean;
  onEcho(): void; onStar(): void; onAnswer(): void;
}) {
  return (
    <div className={`rounded-2xl border border-brand-orange/60 bg-brand-card p-5 shadow-orange-glow ${isNew ? 'animate-fade-up' : ''}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-bold text-brand-orange tracking-wide">🔥 TOP QUESTION</span>
        {view === 'host' && (
          <div className="ml-auto flex gap-2">
            <button onClick={onStar} className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${q.starred ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10' : 'border-brand-border/60 text-white/70 hover:border-yellow-500/40 hover:text-yellow-400'}`}>
              ★ {q.starred ? 'Starred' : 'Star'}
            </button>
            <button onClick={onAnswer} className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${q.answered ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10' : 'border-brand-border/60 text-white/70 hover:border-green-500/40 hover:text-green-400'}`}>
              {q.answered ? '✓ Answered' : '✓ Mark answered'}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-4 sm:gap-6">
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg font-bold leading-snug mb-3">{q.text}</p>
          <div className="flex items-center gap-2 text-xs text-white/70 flex-wrap">
            {q.starred && <span className="text-yellow-400 font-semibold">★ Starred</span>}
            {q.answered && <span className="text-emerald-400 font-semibold">✓ Answered</span>}
            <Avatar name={q.author} color={q.authorColor} size="xs" />
            <span className="font-medium text-white/60">{q.author}</span>
            <span>·</span>
            <span>{q.ago}</span>
          </div>
          {q.host_reply && (
            <div className="mt-3 pl-3 border-l-2 border-brand-orange/40">
              <p className="text-xs text-brand-orange/70 font-semibold mb-1">Host reply</p>
              <p className="text-sm text-white/80">{q.host_reply}</p>
            </div>
          )}
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
              disabled={q.echoed || !!noCredits}
              className={`w-full flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition-all duration-150 active:scale-95 ${
                q.echoed
                  ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                  : noCredits
                  ? 'border-brand-border/30 text-white/50 cursor-not-allowed'
                  : 'border-brand-border text-white/80 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
              }`}
            >
              <span className="text-xl font-black leading-none">↑</span>
              <span className="text-2xl font-black leading-none">{q.echoes}</span>
              <span className="text-[10px] font-semibold tracking-wide opacity-60">Echoes</span>
            </button>
          </div>

          {q.supporters && (
            <div className="flex -space-x-1.5">
              {q.supporters.slice(0, 4).map((s, i) => (
                <div
                  key={i}
                  className="w-5 h-5 rounded-full border-2 border-brand-bg flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ backgroundColor: AUTHOR_COLORS[s] ?? '#7C3AED' }}
                >
                  {s[0].toUpperCase()}
                </div>
              ))}
              <div className="w-5 h-5 rounded-full border-2 border-brand-bg bg-brand-border text-white/70 text-[8px] flex items-center justify-center font-semibold">
                +38
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  q, view, isNew, showFlash, noCredits, onEcho, onStar, onAnswer,
}: {
  q: Q; view: 'audience' | 'host'; isNew?: boolean; showFlash?: boolean; noCredits?: boolean;
  onEcho(): void; onStar(): void; onAnswer(): void;
}) {
  return (
    <div
      className={`flex gap-3 rounded-2xl border bg-brand-card p-4 transition-all duration-200 ${
        q.starred    ? 'border-yellow-500/40 bg-yellow-500/5' :
        q.answered   ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70' :
                       'border-brand-border hover:border-brand-border/80'
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
          <div className="flex flex-col items-center gap-0.5 text-emerald-400 pt-1">
            <span className="text-lg font-bold leading-none">✓</span>
            <span className="text-sm font-bold">{q.echoes}</span>
          </div>
        ) : (
          <button
            onClick={onEcho}
            disabled={q.echoed || !!noCredits}
            className={`flex flex-col items-center gap-0.5 w-full py-2 rounded-xl transition-all active:scale-95 ${
              q.echoed ? 'text-brand-amber' : noCredits ? 'text-white/50 cursor-not-allowed' : 'text-white/65 hover:text-brand-orange'
            }`}
          >
            <span className="text-lg font-black leading-none">↑</span>
            <span className="text-sm font-bold">{q.echoes}</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm sm:text-[15px] leading-relaxed mb-2">{q.text}</p>

        {q.host_reply && (
          <div className="mb-2 pl-3 border-l-2 border-brand-orange/40">
            <p className="text-xs text-brand-orange/70 font-semibold mb-0.5">Host reply</p>
            <p className="text-xs text-white/80">{q.host_reply}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-white/65">
            <Avatar name={q.author} color={q.authorColor} size="xs" />
            <span>{q.author}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/60 shrink-0 flex-wrap">
            {q.starred  && <span className="text-yellow-400 font-semibold">★ Starred</span>}
            {q.answered && <span className="text-[11px] font-semibold text-emerald-400">✓ Answered</span>}
            <span>{q.ago}</span>
            {view === 'host' && (
              <div className="flex gap-1.5">
                <button
                  onClick={onStar}
                  className={`px-2 py-0.5 rounded border transition-all ${
                    q.starred
                      ? 'border-yellow-500/40 text-yellow-400'
                      : 'border-brand-border text-white/65 hover:border-yellow-500/40 hover:text-yellow-400'
                  }`}
                >
                  ★ {q.starred ? 'Starred' : 'Star'}
                </button>
                <button
                  onClick={onAnswer}
                  className={`px-2 py-0.5 rounded border transition-all ${
                    q.answered
                      ? 'border-emerald-500/40 text-emerald-400 hover:border-red-500/40 hover:text-red-400'
                      : 'border-brand-border text-white/65 hover:border-emerald-500/40 hover:text-emerald-400'
                  }`}
                >
                  {q.answered ? 'Reopen' : '✓ Answered'}
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
  const titleParam  = params.get('title') ?? 'Sable & The Echo — Album Release AMA';
  const isHostParam = params.get('host') === 'true';
  const creditsParam = Number(params.get('credits') ?? 6);

  const [qs, setQs]             = useState<Q[]>(() => getSeed(titleParam));
  const [sort, setSort]         = useState<'top' | 'recent' | 'answered' | 'starred'>('top');
  const [view, setView]         = useState<'audience' | 'host'>(isHostParam ? 'host' : 'audience');
  const [draft, setDraft]       = useState('');
  const [isAnon, setIsAnon]     = useState(false);
  const [anonCounter, setAnonCounter] = useState(0);
  const [credits, setCredits]   = useState(creditsParam);
  const [submitted, setSubmitted] = useState(false);
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
    const t = setTimeout(() => {
      const newQ: Q = {
        id: 99,
        text: getAutoQ(titleParam),
        echoes: 0, echoed: false, answered: false, starred: false,
        author: 'new_arrival_52', authorColor: '#0891B2',
        ago: 'just now', ts: Date.now(),
      };
      setQs(prev => prev.some(x => x.id === 99) ? prev : [...prev, newQ]);
      setNewIds(prev => new Set([...prev, 99]));
    }, 9000);
    return () => clearTimeout(t);
  }, []);

  function echo(id: number) {
    if (view === 'audience' && credits <= 0) return;
    setQs(prev => prev.map(q => q.id === id && !q.echoed ? { ...q, echoes: q.echoes + 1, echoed: true } : q));
    if (view === 'audience') setCredits(c => c - 1);
    setEchoFlash(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setEchoFlash(prev => ({ ...prev, [id]: false })), 650);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || credits === 0) return;
    const id = Date.now();
    const anonLabel = isAnon ? `Anon${anonCounter + 1}` : null;
    if (isAnon) setAnonCounter(c => c + 1);
    setQs(prev => [...prev, {
      id, text, echoes: 0, echoed: false, answered: false, starred: false,
      author: anonLabel ?? guestName, authorColor: isAnon ? '#6B7280' : '#0891B2',
      ago: 'just now', ts: Date.now(),
    }]);
    setNewIds(prev => new Set([...prev, id]));
    setDraft('');
    setCredits(c => c - 1);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  }

  function toggleStar(id: number) {
    setQs(prev => prev.map(q => q.id === id ? { ...q, starred: !q.starred } : q));
  }

  function toggleAnswer(id: number) {
    setQs(prev => prev.map(q => q.id === id ? { ...q, answered: !q.answered } : q));
  }

  const allSorted = [...qs].sort((a, b) => {
    if (sort === 'recent')  return b.ts - a.ts;
    if (sort === 'starred') return (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.echoes - a.echoes;
    return b.echoes - a.echoes;
  });

  const unanswered   = allSorted.filter(q => !q.answered);
  const answeredList = allSorted.filter(q => q.answered);
  const starredList  = allSorted.filter(q => q.starred);
  const featuredQ    = sort === 'top' ? (unanswered[0] ?? null) : null;
  const listQs       = sort === 'answered'
    ? answeredList
    : sort === 'starred'
    ? starredList
    : sort === 'top'
      ? [...unanswered.slice(1), ...answeredList]
      : [...unanswered, ...answeredList];

  const totalAsked  = qs.length;
  const awaitingAns = qs.filter(q => !q.answered).length;
  const answeredCnt = qs.filter(q => q.answered).length;

  // ── Top Participants: echoes received per author ──────────────────────────
  const topParticipants = useMemo((): Participant[] => {
    const map = new Map<string, { color: string; echoes: number }>();
    qs.forEach(q => {
      if (q.author === 'anon') return;
      const prev = map.get(q.author);
      map.set(q.author, {
        color: q.authorColor,
        echoes: (prev?.echoes ?? 0) + q.echoes,
      });
    });
    return [...map.entries()]
      .map(([name, { color, echoes }]) => ({ name, color, echoes }))
      .sort((a, b) => b.echoes - a.echoes)
      .slice(0, 5);
  }, [qs]);

  // ── Duplicate detection ───────────────────────────────────────────────────
  const similar = useMemo(() => {
    if (draft.length < 12) return [];
    const words = draft.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    if (!words.length) return [];
    return qs
      .filter(q => !q.answered)
      .filter(q => words.some(w => q.text.toLowerCase().includes(w)))
      .slice(0, 2);
  }, [draft, qs]);

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
          <div className="px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
            <Link
              href="/demo"
              className="text-white/65 hover:text-white/70 transition-colors text-sm font-medium flex items-center gap-1 shrink-0"
            >
              <span className="sm:hidden">←</span>
              <span className="hidden sm:inline">← Discover</span>
            </Link>
            <span className="hidden sm:block text-brand-border/40 shrink-0">/</span>
            <Link href="/" className="font-display text-lg font-bold shrink-0">
              Guest<span className="text-brand-orange">Speak</span>
            </Link>
            <span className="hidden sm:block text-[10px] font-bold text-brand-orange/60 bg-brand-orange/10 border border-brand-orange/20 px-1.5 py-0.5 rounded-full tracking-wider shrink-0">
              DEMO
            </span>

            <div className="hidden sm:flex items-center gap-2.5 mx-auto">
              <span className="badge-live">Live</span>
              <h1 className="font-display font-bold text-base sm:text-lg truncate max-w-xs">{titleParam}</h1>
            </div>

            <div className="flex items-center gap-3 ml-auto shrink-0">
              <div className="hidden md:flex items-center gap-4 text-sm text-white/80">
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
                    view === 'audience' ? 'bg-brand-orange text-brand-bg' : 'text-white/80 hover:text-white'
                  }`}
                >
                  Audience
                </button>
                <button
                  onClick={() => setView('host')}
                  className={`px-3 sm:px-4 py-1.5 font-semibold transition-all ${
                    view === 'host' ? 'bg-brand-orange text-brand-bg' : 'text-white/80 hover:text-white'
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
                <p className="text-[10px] font-bold text-white/55 uppercase tracking-widest mb-3">📋 Session</p>
                <h2 className="font-display font-bold text-[15px] leading-snug mb-1">{titleParam}</h2>
                <p className="text-xs text-white/70 mb-1">Live now on GuestSpeak</p>
                <p className="text-xs text-white/65">
                  Hosted by <span className="text-brand-amber font-semibold">Shawn G.</span>
                </p>
              </div>

              <div className="flex flex-col gap-2 text-xs text-white/70">
                <span className="flex items-center gap-2">📅 Tonight · started 15 min ago</span>
                <span className="flex items-center gap-2">⏱ 45 min remaining</span>
                <span className="flex items-center gap-2">📍 Streaming live</span>
              </div>

              <div className="border-t border-brand-border/40 pt-4 flex flex-col gap-3">
                {[
                  { label: 'Questions asked', value: totalAsked },
                  { label: 'Awaiting answer',  value: awaitingAns },
                  { label: 'Answered',          value: answeredCnt },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span className="text-xs text-white/65">{s.label}</span>
                    <span className="text-lg font-bold">{s.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-auto border-t border-brand-border/40 pt-4">
                <div className="rounded-xl bg-brand-purple/15 border border-brand-purple/25 p-3.5 text-center">
                  <p className="text-xs font-bold text-white/60 mb-1">Join the conversation</p>
                  <p className="text-[11px] text-white/60 mb-3">Ask your own question, or Echo the ones you love.</p>
                  <div className="bg-brand-bg rounded-lg px-3 py-2 mb-3">
                    <p className="text-[10px] text-white/55 mb-0.5">Join code</p>
                    <p className="text-base font-bold text-brand-amber tracking-[0.2em]">GS-7XK</p>
                  </div>
                  <p className="text-xs text-brand-orange font-semibold">guestspeak.app</p>
                </div>
              </div>
            </div>
          </aside>

          {/* Center Feed */}
          <div className="flex-1 min-w-0 flex flex-col lg:min-h-0">

            {/* Sort tabs — always visible, never scrolls away */}
            <div className="shrink-0 flex items-center border-b border-brand-border bg-brand-bg z-10 overflow-x-auto gap-0">
              {[
                { id: 'top',      label: '🔥 Top' },
                { id: 'recent',   label: '🕐 Recent' },
                { id: 'answered', label: '✓ Answered' },
                { id: 'starred',  label: '★ Starred' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setSort(t.id as typeof sort)}
                  className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all whitespace-nowrap ${
                    sort === t.id
                      ? 'border-brand-orange text-white'
                      : 'border-transparent text-white/75 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              {view === 'audience' && (
                <button
                  onClick={() => document.getElementById('ask-input')?.focus()}
                  className="ml-auto hidden sm:flex items-center gap-1.5 bg-orange-gradient text-white font-bold text-xs sm:text-sm px-3 sm:px-4 py-1.5 rounded-lg shadow-orange-glow hover:brightness-110 transition-all my-2 mx-3 shrink-0"
                >
                  ✏️ Ask a question
                </button>
              )}
            </div>

            <main className="flex-1 lg:overflow-y-auto">
            <div className="p-4 sm:p-5 flex flex-col gap-3 pb-28 lg:pb-6">
              {featuredQ && (
                <TopQuestionCard
                  q={featuredQ}
                  view={view}
                  isNew={newIds.has(featuredQ.id)}
                  showFlash={!!echoFlash[featuredQ.id]}
                  noCredits={credits === 0 && view === 'audience'}
                  onEcho={() => echo(featuredQ.id)}
                  onStar={() => toggleStar(featuredQ.id)}
                  onAnswer={() => toggleAnswer(featuredQ.id)}
                />
              )}

              {sort === 'answered' && answeredList.length === 0 && (
                <div className="text-center py-16 text-white/55 text-sm">Nothing answered yet — the host is just warming up</div>
              )}

              {listQs.map(q => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  view={view}
                  isNew={newIds.has(q.id)}
                  showFlash={!!echoFlash[q.id]}
                  noCredits={credits === 0 && view === 'audience'}
                  onEcho={() => echo(q.id)}
                  onStar={() => toggleStar(q.id)}
                  onAnswer={() => toggleAnswer(q.id)}
                />
              ))}
            </div>
            </main>
          </div>

          {/* Right Sidebar */}
          <aside className="hidden xl:flex flex-col w-64 border-l border-brand-border shrink-0 overflow-y-auto min-h-0">
            {/* Top Questions */}
            <div className="p-4 border-b border-brand-border/40">
              <p className="text-[10px] font-bold text-white/55 uppercase tracking-widest mb-3">Top Questions</p>
              <div className="flex flex-col gap-3">
                {[...qs]
                  .filter(q => !q.answered)
                  .sort((a, b) => b.echoes - a.echoes)
                  .slice(0, 5)
                  .map((q, i) => (
                    <div key={q.id} className="flex items-start gap-2.5">
                      <span className={`text-xs font-bold w-4 shrink-0 mt-0.5 ${i === 0 ? 'text-brand-amber' : 'text-white/55'}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/80 leading-relaxed line-clamp-2">{q.text}</p>
                        <p className="text-[11px] text-brand-orange mt-0.5">{q.echoes} echoes</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Top Participants */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold text-white/55 uppercase tracking-widest">Top Participants</p>
                <p className="text-[10px] text-white/50">Echoes received</p>
              </div>
              <div className="flex flex-col gap-3">
                {topParticipants.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span className={`text-xs font-bold w-4 text-center shrink-0 ${i === 0 ? 'text-brand-amber' : 'text-white/55'}`}>
                      {i + 1}
                    </span>
                    <Avatar name={p.name} color={p.color} size="xs" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white/70 truncate">{p.name}</p>
                      <p className="text-[11px] text-white/60">{p.echoes} echoes received</p>
                    </div>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i === 0 ? 'bg-brand-amber/20 text-brand-amber' : 'bg-white/5 text-white/65'}`}>
                      {p.echoes}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {/* Bottom Ask Bar */}
        <div className="border-t border-brand-border bg-brand-bg/95 backdrop-blur shrink-0 z-20 sticky bottom-0 lg:relative">
          {/* Duplicate detection panel */}
          {view === 'audience' && similar.length > 0 && draft.length > 0 && (
            <div className="border-b border-brand-border/60 px-4 sm:px-6 py-3 bg-brand-amber/5">
              <p className="text-[11px] font-bold text-brand-amber uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                <span>💡</span> Similar questions already asked
              </p>
              <div className="flex flex-col gap-2">
                {similar.map(q => (
                  <div key={q.id} className="flex items-center gap-3">
                    <span className="text-brand-orange/60 text-xs font-bold shrink-0">↑ {q.echoes}</span>
                    <p className="flex-1 text-xs text-white/85 line-clamp-1">{q.text}</p>
                    <button
                      onClick={() => { echo(q.id); setDraft(''); }}
                      disabled={q.echoed || credits === 0}
                      className="shrink-0 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-brand-orange/10 border border-brand-orange/30 text-brand-orange hover:bg-brand-orange/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {q.echoed ? '✓ Echoed' : '↑ Echo instead'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {view === 'audience' ? (
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4">
              <div className="hidden sm:block shrink-0">
                <p className="text-xs font-bold text-white/60 mb-1.5">Ask a question</p>
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: creditsParam }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full transition-colors ${
                        i < credits ? 'bg-brand-orange' : 'bg-brand-border/40'
                      }`}
                    />
                  ))}
                  <span className="text-[10px] text-white/60 ml-0.5">
                    {credits} credit{credits !== 1 ? 's' : ''} left
                  </span>
                </div>
              </div>

              {submitted ? (
                <div className="flex-1 py-2 text-center text-sm text-green-400 font-semibold animate-fade-up">
                  ✓ Question submitted — the room can Echo it now
                </div>
              ) : credits === 0 ? (
                <div className="flex-1 py-2 text-center text-sm text-white/55">
                  You&apos;re out of credits for this session — sit back and watch the Echoes roll in
                </div>
              ) : (
                <form onSubmit={submit} className="flex-1 flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      id="ask-input"
                      className="input text-sm !py-2.5 w-full pr-14"
                      placeholder="What do you want to ask?"
                      value={draft}
                      onChange={e => setDraft(e.target.value.slice(0, 300))}
                    />
                    {draft.length > 0 && (
                      <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums pointer-events-none ${
                        draft.length >= 280 ? 'text-red-400' : 'text-white/55'
                      }`}>
                        {300 - draft.length}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAnon(v => !v)}
                    className={`hidden sm:block shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border transition-all ${
                      isAnon
                        ? 'border-brand-purple/60 text-brand-purple-light bg-brand-purple/10'
                        : 'border-brand-border text-white/65 hover:border-white/20'
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
                        : 'bg-brand-card border border-brand-border text-white/50 cursor-default'
                    }`}
                  >
                    <span className="sm:hidden">↑ Ask</span>
                    <span className="hidden sm:inline">↑ Submit</span>
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 text-sm">
              <span className="font-semibold text-brand-amber">🎤 Host view</span>
              <span className="text-white/60 hidden sm:inline">
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
