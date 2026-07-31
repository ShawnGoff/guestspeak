'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type Q = {
  id: number;
  text: string;
  echoes: number;
  echoed: boolean;
  pinned: boolean;
  answered: boolean;
  author: string;
  ago: string;
};

const SEED: Q[] = [
  {
    id: 1,
    text: 'Will we be adopting AI-native tooling across the full design sprint process?',
    echoes: 47,
    echoed: false,
    pinned: true,
    answered: false,
    author: 'curious_dev_91',
    ago: '2m ago',
  },
  {
    id: 2,
    text: "What's the roadmap for integrating AI into our component library workflows?",
    echoes: 31,
    echoed: false,
    pinned: false,
    answered: false,
    author: 'design_thinker_77',
    ago: '4m ago',
  },
  {
    id: 3,
    text: 'How are we thinking about AI-generated content vs. human creative direction?',
    echoes: 28,
    echoed: false,
    pinned: false,
    answered: false,
    author: 'luma_builds',
    ago: '5m ago',
  },
  {
    id: 4,
    text: 'Are there plans to provide AI tooling training specifically for the front-end team?',
    echoes: 19,
    echoed: false,
    pinned: false,
    answered: false,
    author: 'syntax_seeker',
    ago: '7m ago',
  },
  {
    id: 5,
    text: 'What metrics are we using to evaluate AI productivity gains across teams?',
    echoes: 14,
    echoed: false,
    pinned: false,
    answered: false,
    author: 'metric_mind_33',
    ago: '9m ago',
  },
  {
    id: 6,
    text: 'Will design tokens and theme variables ever be AI-generated?',
    echoes: 8,
    echoed: false,
    pinned: false,
    answered: true,
    author: 'token_engineer',
    ago: '12m ago',
  },
  {
    id: 7,
    text: 'How do we handle attribution for AI-assisted work in our portfolios?',
    echoes: 3,
    echoed: false,
    pinned: false,
    answered: false,
    author: 'credit_curious',
    ago: '14m ago',
  },
];

function QuestionCard({
  q,
  view,
  onEcho,
  onPin,
  onAnswer,
  isNew,
}: {
  q: Q;
  view: 'audience' | 'host';
  onEcho: () => void;
  onPin: () => void;
  onAnswer: () => void;
  isNew?: boolean;
}) {
  return (
    <div
      className={`card p-4 transition-all duration-300 ${
        q.pinned ? 'border-brand-orange shadow-orange-glow' : ''
      } ${q.answered ? 'opacity-50' : ''} ${
        isNew ? 'animate-fade-up' : ''
      }`}
    >
      {(q.pinned || q.answered) && (
        <div className="flex gap-2 mb-3">
          {q.pinned && (
            <span className="text-xs font-bold text-brand-orange bg-brand-orange/15 px-2.5 py-0.5 rounded-full uppercase tracking-wide">
              📌 Up next
            </span>
          )}
          {q.answered && (
            <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2.5 py-0.5 rounded-full uppercase tracking-wide">
              ✓ Answered
            </span>
          )}
        </div>
      )}

      <p className="text-sm sm:text-[15px] leading-relaxed mb-3">{q.text}</p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-white/30 truncate">
          {q.author} · {q.ago}
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {view === 'host' && (
            <>
              <button
                onClick={onPin}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all duration-150 ${
                  q.pinned
                    ? 'border-brand-orange/50 bg-brand-orange/15 text-brand-orange'
                    : 'border-brand-border text-white/40 hover:border-brand-orange/50 hover:text-brand-orange'
                }`}
              >
                {q.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onClick={onAnswer}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all duration-150 ${
                  q.answered
                    ? 'border-green-500/40 bg-green-500/10 text-green-400'
                    : 'border-brand-border text-white/40 hover:border-green-500/40 hover:text-green-400'
                }`}
              >
                {q.answered ? 'Reopen' : 'Answered'}
              </button>
            </>
          )}

          {/* Echo button */}
          <button
            onClick={onEcho}
            disabled={q.echoed}
            title={q.echoed ? 'Already echoed' : 'Echo this question'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold border transition-all duration-150 active:scale-95 ${
              q.echoed
                ? 'border-brand-amber/40 bg-brand-amber/15 text-brand-amber cursor-default'
                : 'border-brand-border text-white/50 hover:border-brand-amber/40 hover:text-brand-amber cursor-pointer'
            }`}
          >
            <span className="text-base leading-none">◎</span>
            <span>{q.echoes}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DemoPage() {
  const [qs, setQs] = useState<Q[]>(SEED);
  const [draft, setDraft] = useState('');
  const [view, setView] = useState<'audience' | 'host'>('audience');
  const [submitted, setSubmitted] = useState(false);
  const [credits, setCredits] = useState(3);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const guestName = 'stellar_wave_88';

  // Simulate a new question arriving in real-time
  useEffect(() => {
    const t = setTimeout(() => {
      const incoming: Q = {
        id: 99,
        text: 'Can we see a live demo of how AI tools are being used right now in the current sprint?',
        echoes: 0,
        echoed: false,
        pinned: false,
        answered: false,
        author: 'new_arrival_52',
        ago: 'just now',
      };
      setQs(prev => {
        if (prev.some(q => q.id === 99)) return prev;
        return [...prev, incoming];
      });
      setNewIds(prev => new Set([...prev, 99]));
    }, 9000);
    return () => clearTimeout(t);
  }, []);

  const sorted = [...qs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.echoes - a.echoes;
  });

  function echo(id: number) {
    setQs(prev =>
      prev.map(q =>
        q.id === id && !q.echoed ? { ...q, echoes: q.echoes + 1, echoed: true } : q
      )
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || credits === 0) return;
    const id = Date.now();
    setQs(prev => [
      ...prev,
      {
        id,
        text,
        echoes: 0,
        echoed: false,
        pinned: false,
        answered: false,
        author: guestName,
        ago: 'just now',
      },
    ]);
    setNewIds(prev => new Set([...prev, id]));
    setDraft('');
    setCredits(c => c - 1);
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  }

  function togglePin(id: number) {
    setQs(prev =>
      prev.map(q => (q.id === id ? { ...q, pinned: !q.pinned } : { ...q, pinned: false }))
    );
  }

  function toggleAnswer(id: number) {
    setQs(prev => prev.map(q => (q.id === id ? { ...q, answered: !q.answered } : q)));
  }

  return (
    <div className="min-h-screen bg-brand-bg text-white font-sans">
      {/* Demo banner */}
      <div className="bg-brand-orange text-brand-bg py-2 px-4 flex items-center justify-center gap-4 text-sm font-semibold">
        <span>✦ Demo Mode — no sign-in needed. Echo questions, try Host View, or submit your own.</span>
        <Link
          href="/"
          className="text-brand-bg/70 underline hover:text-brand-bg transition-colors text-xs whitespace-nowrap"
        >
          ← Back to home
        </Link>
      </div>

      {/* Session header */}
      <header className="border-b border-brand-border px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="badge-live">Live</span>
          <div>
            <h1 className="font-display text-lg sm:text-xl font-bold leading-tight">
              AI in Product Development
            </h1>
            <p className="text-xs text-white/40 mt-0.5">
              Design &amp; Engineering All Hands · hosted by{' '}
              <span className="text-brand-amber">Shawn G.</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-white/40">
            <span className="text-brand-amber font-semibold">143</span> attending
          </span>

          {/* Audience / Host toggle */}
          <div className="flex bg-brand-card border border-brand-border rounded-lg overflow-hidden text-sm">
            <button
              onClick={() => setView('audience')}
              className={`px-4 py-1.5 font-semibold transition-all duration-150 ${
                view === 'audience'
                  ? 'bg-brand-orange text-brand-bg'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              Audience
            </button>
            <button
              onClick={() => setView('host')}
              className={`px-4 py-1.5 font-semibold transition-all duration-150 ${
                view === 'host'
                  ? 'bg-brand-orange text-brand-bg'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              🎤 Host
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-16">
        {/* Context strip */}
        {view === 'audience' ? (
          <p className="text-sm text-white/40 mb-5">
            Participating as{' '}
            <span className="text-brand-amber font-semibold">{guestName}</span>
            {' · '}
            <span className={credits === 0 ? 'text-white/20' : ''}>
              {credits} question{credits !== 1 ? 's' : ''} remaining
            </span>
          </p>
        ) : (
          <div className="mb-5 px-4 py-3 rounded-xl border border-brand-orange/30 bg-brand-orange/10 text-brand-amber text-sm font-medium">
            🎤 You&apos;re the host — pin the next question, mark answered ones, and manage the feed.
          </div>
        )}

        {/* Question feed */}
        <div className="flex flex-col gap-3">
          {sorted.map(q => (
            <QuestionCard
              key={q.id}
              q={q}
              view={view}
              isNew={newIds.has(q.id)}
              onEcho={() => echo(q.id)}
              onPin={() => togglePin(q.id)}
              onAnswer={() => toggleAnswer(q.id)}
            />
          ))}
        </div>

        {/* Submit question */}
        {view === 'audience' && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-white/70 mb-3">Ask a question</h2>

            {submitted ? (
              <div className="py-4 rounded-xl border border-green-500/30 bg-green-500/10 text-green-400 text-center text-sm font-semibold animate-fade-up">
                ✓ Your question is live — the host can see it
              </div>
            ) : credits === 0 ? (
              <div className="py-4 rounded-xl border border-brand-border bg-brand-card text-white/30 text-center text-sm">
                You&apos;ve used all your questions for this session
              </div>
            ) : (
              <form onSubmit={submit}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value.slice(0, 300))}
                  placeholder="What's on your mind? Clear, specific questions get the most Echoes."
                  rows={3}
                  className="input resize-none text-sm"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-white/30">{draft.length}/300</span>
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    className={`px-5 py-2 rounded-xl text-sm font-bold transition-all duration-150 ${
                      draft.trim()
                        ? 'bg-orange-gradient text-white shadow-orange-glow hover:brightness-110 active:scale-95 cursor-pointer'
                        : 'bg-brand-card border border-brand-border text-white/20 cursor-default'
                    }`}
                  >
                    Submit
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Footer link */}
        <div className="mt-12 pt-8 border-t border-brand-border/50 text-center">
          <p className="text-xs text-white/30 mb-3">
            Like what you see? GuestSpeak is launching soon.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-brand-amber text-sm font-semibold hover:text-brand-orange transition-colors"
          >
            Get early access →
          </Link>
        </div>
      </main>
    </div>
  );
}
