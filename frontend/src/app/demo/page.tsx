'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const LIVE_SESSIONS = [
  {
    id: 1,
    title: 'Coach Marcus Ellis — Postgame AMA',
    org: '97.5 The Pulse · Live Radio',
    attendees: 312,
    questions: 24,
    tags: ['NBA', 'Basketball', 'AMA'],
    code: 'PLZ-4ME',
    host: 'pulse_radio',
    hostColor: '#DC2626',
    isHost: true,
  },
  {
    id: 2,
    title: 'Startup Demo Day — Spring Cohort Pitches',
    org: 'Founders & Funders SF',
    attendees: 88,
    questions: 15,
    tags: ['Startups', 'Funding', 'Pitches'],
    code: 'FF-9QR',
    host: 'founders_sf',
    hostColor: '#059669',
    isHost: false,
  },
];

const UPCOMING_SESSIONS = [
  {
    id: 3,
    title: 'New Album Listening Party — Sable & The Echo',
    org: 'Westside Records',
    when: 'Tonight · 8:00 PM',
    registered: 156,
    tags: ['Music', 'Artist', 'Live'],
  },
  {
    id: 4,
    title: 'Intro to Machine Learning — Open Office Hours',
    org: 'Stanford Online',
    when: 'Tomorrow · 11:00 AM',
    registered: 94,
    tags: ['ML', 'Education', 'Q&A'],
  },
  {
    id: 5,
    title: 'District 7 Town Hall — Community Listening Session',
    org: 'Oakland City Council',
    when: 'Sat · 10:00 AM',
    registered: 203,
    tags: ['Civic', 'Policy', 'Community'],
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

function TagPill({ label }: { label: string }) {
  return (
    <span className="text-[11px] text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full whitespace-nowrap">
      {label}
    </span>
  );
}

function LiveCard({ session }: { session: typeof LIVE_SESSIONS[0] }) {
  return (
    <Link
      href={`/demo/session?title=${encodeURIComponent(session.title)}`}
      className="card group p-5 hover:border-brand-orange/40 transition-all flex flex-col gap-4"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              LIVE
            </span>
            <span className="text-xs text-white/30">{session.org}</span>
          </div>
          <h3 className="font-bold text-white text-base leading-snug group-hover:text-brand-amber transition-colors">
            {session.title}
          </h3>
        </div>
        <div className="bg-brand-card border border-brand-border rounded-xl px-3 py-2 text-center shrink-0">
          <p className="text-[10px] text-white/25 font-medium mb-0.5">code</p>
          <p className="text-sm font-bold text-brand-amber tracking-widest">{session.code}</p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {session.tags.map(t => <TagPill key={t} label={t} />)}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-brand-border/40">
        <div className="flex items-center gap-3 text-xs text-white/35">
          <span className="flex items-center gap-1">
            <span className="text-white/50 font-bold">{session.attendees}</span> attending
          </span>
          <span className="flex items-center gap-1">
            <span className="text-white/50 font-bold">{session.questions}</span> questions
          </span>
        </div>
        {session.isHost ? (
          <span className="text-sm font-bold text-brand-purple group-hover:text-purple-300 transition-colors flex items-center gap-1">
            Manage session <span>→</span>
          </span>
        ) : (
          <span className="text-sm font-bold text-brand-orange group-hover:text-brand-amber transition-colors flex items-center gap-1">
            Join as audience <span>→</span>
          </span>
        )}
      </div>
    </Link>
  );
}

function UpcomingCard({ session }: { session: typeof UPCOMING_SESSIONS[0] }) {
  const [reminded, setReminded] = useState(false);

  return (
    <div className="card p-4 flex items-center gap-4 hover:border-brand-purple/40 transition-all group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-brand-amber/70 font-medium">{session.when}</span>
          <span className="text-white/20">·</span>
          <span className="text-xs text-white/30">{session.org}</span>
        </div>
        <p className="font-semibold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors">
          {session.title}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {session.tags.map(t => <TagPill key={t} label={t} />)}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-white/30 mb-1">{session.registered} registered</p>
        {reminded ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange border border-brand-orange/40 bg-brand-orange/10 px-3 py-1.5 rounded-lg">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
            Reminder set
          </span>
        ) : (
          <button
            onClick={() => setReminded(true)}
            className="text-xs font-semibold text-white/40 hover:text-white/70 border border-brand-border hover:border-brand-purple/40 px-3 py-1.5 rounded-lg transition-all"
          >
            Remind me
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const router = useRouter();
  const [code, setCode] = useState('');

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    const match = [...LIVE_SESSIONS].find(s => s.code === code.trim().toUpperCase());
    const title = match ? match.title : 'Live Session';
    router.push(`/demo/session?title=${encodeURIComponent(title)}`);
  }

  return (
    <div className="min-h-screen bg-brand-bg text-white overflow-x-hidden">

      {/* Header */}
      <header className="border-b border-brand-border bg-brand-bg/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="font-display text-xl font-bold">
              Guest<span className="text-brand-orange">Speak</span>
            </Link>
            <span className="text-[10px] font-bold text-brand-orange/60 bg-brand-orange/10 border border-brand-orange/20 px-1.5 py-0.5 rounded-full tracking-wider">
              DEMO
            </span>
          </div>

          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <span className="px-3 py-1.5 rounded-lg bg-brand-orange/10 text-brand-orange font-semibold">
              Discover
            </span>
            <span className="text-white/20 mx-1">→</span>
            <Link href="/demo/create" className="px-3 py-1.5 rounded-lg text-white/35 hover:text-white/70 transition-colors font-medium">
              Create
            </Link>
            <span className="text-white/20 mx-1">→</span>
            <span className="px-3 py-1.5 rounded-lg text-white/20 font-medium">
              Session
            </span>
          </nav>

          <Link
            href="/demo/create"
            className="btn-primary text-sm py-2 px-5 shrink-0"
          >
            + Host a session
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">

        {/* Hero */}
        <div className="mb-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <p className="text-brand-orange text-sm font-semibold uppercase tracking-widest mb-2">Interactive demo</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">
                Live sessions happening now
              </h1>
              <p className="text-purple-200/55 text-lg max-w-xl">
                Join a live session as an audience member, or host your own to see GuestSpeak from both sides.
              </p>
            </div>

            {/* Join by code */}
            <form onSubmit={handleJoin} className="flex gap-0 w-full md:w-auto">
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                placeholder="Enter session code"
                maxLength={12}
                className="flex-1 md:w-44 bg-brand-card border border-brand-border border-r-0 rounded-l-xl px-4 py-3
                           text-white placeholder-white/30 text-sm font-medium
                           focus:outline-none focus:border-brand-purple transition-colors"
              />
              <button
                type="submit"
                className="btn-primary rounded-l-none px-5 py-3 text-sm"
              >
                Join →
              </button>
            </form>
          </div>
        </div>

        {/* Live Now */}
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-bold text-white">Live now</h2>
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              {LIVE_SESSIONS.length} sessions
            </span>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {LIVE_SESSIONS.map(s => <LiveCard key={s.id} session={s} />)}
          </div>
        </section>

        {/* Divider + Host CTA */}
        <div className="rounded-2xl bg-gradient-to-r from-brand-orange/10 via-brand-purple/10 to-brand-orange/5 border border-brand-orange/20 px-6 py-6 mb-10 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div>
            <p className="font-bold text-white text-lg mb-1">Want to see the host experience?</p>
            <p className="text-purple-200/55 text-sm">Create a session in seconds. You'll land in the Q&A as the host.</p>
          </div>
          <Link
            href="/demo/create"
            className="btn-primary px-8 py-3.5 shrink-0 whitespace-nowrap"
          >
            Host a session →
          </Link>
        </div>

        {/* Upcoming */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Upcoming sessions</h2>
            <span className="text-xs text-white/30">{UPCOMING_SESSIONS.length} scheduled</span>
          </div>
          <div className="flex flex-col gap-3">
            {UPCOMING_SESSIONS.map(s => <UpcomingCard key={s.id} session={s} />)}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-brand-border/40 mt-16 py-6 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/25 text-xs">This is a demo — data is simulated, nothing is saved.</p>
          <Link href="/" className="text-brand-orange text-sm font-semibold hover:text-brand-amber transition-colors">
            ← Back to guestspeak.app
          </Link>
        </div>
      </footer>
    </div>
  );
}
