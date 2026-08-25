'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import Footer from '@/components/Footer';
import JoinByCode from '@/components/JoinByCode';
import NotificationBell from '@/components/NotificationBell';
import { UserMenu } from '@/components/AppNav';
import { getUser } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

// ─── Nav ────────────────────────────────────────────────────────────────────

function Nav() {
  // Read after mount, not during render: getUser reads localStorage, which does
  // not exist on the server, and rendering a signed-out nav then swapping it is
  // what every other page already does.
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { setUser(getUser()); }, []);
  const signedIn = !!user && !user.is_guest;

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-brand-border/50 backdrop-blur-md bg-brand-bg/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Logo />
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Same box as every other page's nav. A code read out on air should
              land somewhere obvious wherever the listener happens to be, and
              the home page is where most of them arrive. */}
          <JoinByCode />
          {/* Was hidden below sm, which left the mobile home page with no way
              to reach Discover at all — the only route for somebody who wants
              to look around and has neither a join code nor a session to run.
              Padding is tighter here than on desktop because all three links
              plus the logo fill the bar exactly at 375px. */}
          <Link href="/discover" className="btn-ghost text-sm py-2 px-2.5 sm:px-4 min-h-[44px] flex items-center">
            Discover
          </Link>
          {!signedIn && (
            <Link href="/login" className="btn-ghost text-sm py-2 px-2.5 sm:px-4 min-h-[44px] flex items-center">
              Sign in
            </Link>
          )}
          <Link href="/create" className="btn-primary text-sm py-2 px-3 sm:px-4 min-h-[44px] flex items-center">
            <span className="sm:hidden">Create</span>
            <span className="hidden sm:inline">Create session</span>
          </Link>
          {signedIn && (
            <>
              <NotificationBell />
              <UserMenu user={user!} />
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 select-none min-h-[44px]">
      {/* A step smaller on mobile. With Discover restored, the logo and three
          links filled the 375px bar exactly — 2px of gap — and the wordmark is
          the one piece that can give some back without losing a destination. */}
      <span className="font-display text-lg sm:text-xl font-bold tracking-tight leading-none">
        Guest<span className="text-brand-orange">Speak</span>
      </span>
    </Link>
  );
}

// ─── Mock Q&A Widget ─────────────────────────────────────────────────────────

const MOCK_QUESTIONS = [
  { text: "What's the story behind the title track — it feels way more personal than anything you've released before?", author: "Sadie M.", ago: "2m", top: true },
  { text: "Which collab on this record surprised you the most — and how did it come together?", author: "Priya K.", ago: "4m", top: false },
  { text: "Will the vault tracks ever see the light of day, or are some locked forever?", author: "anon", ago: "6m", top: false },
];

function MockQAWidget() {
  const [echoes, setEchoes] = useState([127, 84, 61]);
  const [flash, setFlash] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [activity, setActivity] = useState<string[]>([
    'Lena just echoed a question',
    '42 people attending',
    'New question submitted',
  ]);
  const frameRef = useRef(0);

  // Animate echo counts up
  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * 3);
      setEchoes(prev => {
        const next = [...prev];
        next[idx] = next[idx] + 1;
        return next;
      });
      setFlash(idx);
      setTimeout(() => setFlash(null), 700);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  // Simulate typing in the ask field
  const DEMO_TEXT = 'Is there a song that almost didn\'t make the album?';
  useEffect(() => {
    let i = 0;
    let typing = true;
    const tick = () => {
      if (typing) {
        i++;
        setTyped(DEMO_TEXT.slice(0, i));
        if (i >= DEMO_TEXT.length) {
          typing = false;
          frameRef.current = window.setTimeout(tick, 2000);
          return;
        }
      } else {
        i--;
        setTyped(DEMO_TEXT.slice(0, i));
        if (i <= 0) {
          typing = true;
          frameRef.current = window.setTimeout(tick, 800);
          return;
        }
      }
      frameRef.current = window.setTimeout(tick, typing ? 55 : 30);
    };
    frameRef.current = window.setTimeout(tick, 1500);
    return () => clearTimeout(frameRef.current);
  }, []);

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="absolute -inset-4 bg-brand-orange/10 blur-[70px] rounded-3xl pointer-events-none" />

      <div className="relative rounded-2xl overflow-hidden border border-brand-orange/30 bg-brand-card shadow-[0_0_40px_rgba(245,146,30,0.15)]">
        {/* Session header */}
        <div className="px-4 py-3 bg-brand-bg/60 border-b border-brand-border/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="badge-live shrink-0">LIVE</span>
            <div className="overflow-hidden min-w-0 flex-1">
              <style>{`
                @keyframes gs-ticker {
                  0%   { transform: translateX(0); }
                  100% { transform: translateX(-50%); }
                }
                .gs-ticker-wrap {
                  animation: gs-ticker 14s linear infinite;
                  display: inline-block;
                  white-space: nowrap;
                }
              `}</style>
              <span className="gs-ticker-wrap text-white text-sm font-semibold">
                Sable &amp; The Echo — Album Release AMA
                <span className="mx-10 opacity-30">·</span>
                Sable &amp; The Echo — Album Release AMA
                <span className="mx-10 opacity-30">·</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 text-purple-200/70 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>42 attending</span>
          </div>
        </div>

        {/* Question feed */}
        <div className="divide-y divide-brand-border/30">
          {MOCK_QUESTIONS.map((q, i) => (
            <div
              key={i}
              className={`flex gap-3 px-4 py-3.5 transition-colors ${i === 0 ? 'bg-brand-orange/5' : ''}`}
            >
              {/* Echo column */}
              <div className="relative flex flex-col items-center gap-1 pt-0.5 shrink-0">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                    i === 0
                      ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30'
                      : 'bg-brand-bg text-purple-200/70 border border-brand-border/40'
                  } ${flash === i ? 'scale-110' : ''}`}
                >
                  ↑
                </div>
                <span
                  className={`text-xs font-bold tabular-nums transition-all duration-300 ${
                    flash === i ? 'text-brand-orange scale-110' : i === 0 ? 'text-brand-amber' : 'text-purple-200/75'
                  }`}
                >
                  {echoes[i]}
                </span>
                {/* +1 echo badge floats up from the count */}
                {flash === i && (
                  <div
                    key={`flash-${i}-${echoes[i]}`}
                    className="absolute -top-1 left-1/2 -translate-x-1/2 bg-brand-orange text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg pointer-events-none whitespace-nowrap z-10"
                    style={{ animation: 'floatBadge 0.7s ease-out forwards' }}
                  >
                    +1 Echo
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {q.top && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-bold text-brand-orange uppercase tracking-wider">★ Top question</span>
                  </div>
                )}
                <p className="text-white text-xs leading-relaxed">{q.text}</p>
                <p className="text-purple-200/65 text-[10px] mt-1.5">{q.author} · {q.ago} ago</p>
              </div>
            </div>
          ))}
        </div>

        {/* Ask bar */}
        <div className="px-3 py-3 border-t border-brand-border/60 bg-brand-bg/40">
          <div className="flex gap-2 items-center">
            <div className="flex-1 bg-brand-bg border border-brand-border rounded-xl px-3 py-2.5 text-xs text-white flex items-center">
              <span>{typed}</span>
              <span className="w-0.5 h-3 bg-brand-orange animate-pulse ml-px" />
            </div>
            <button className="btn-primary text-xs px-4 py-2.5 rounded-xl shrink-0">Ask</button>
          </div>
          <div className="flex items-center justify-end mt-2 px-0.5">
            <span className="text-purple-200/60 text-[10px]">Ask anonymously</span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes floatBadge {
          0%   { opacity: 1; transform: translateY(0) scale(1) translateX(-50%); }
          100% { opacity: 0; transform: translateY(-20px) scale(0.85) translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setJoining(true);
    setJoinError(null);
    try {
      const session = await api.get<{ slug: string }>(`/sessions/code/${code.trim().toUpperCase()}`);
      router.push(`/s/${session.slug}`);
    } catch {
      setJoinError('That code didn\'t match a session — double-check it and try again.');
      setJoining(false);
    }
  }

  return (
    <section className="relative pt-28 pb-12 px-4 overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full bg-brand-purple/20 blur-[140px] pointer-events-none" />
      <div className="absolute top-20 left-1/4 w-[300px] h-[300px] rounded-full bg-brand-orange/8 blur-[100px] pointer-events-none" />
      <div className="absolute top-40 right-1/4 w-[250px] h-[250px] rounded-full bg-brand-purple/15 blur-[80px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Left: copy */}
          <div className="flex-1 text-center lg:text-left max-w-2xl lg:max-w-none">
            {/* Eyebrow */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-brand-purple/50 bg-brand-purple/10 text-brand-amber text-sm font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-amber animate-pulse-slow" />
              Q&amp;A for rooms, streams and shows
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl xl:text-7xl font-extrabold leading-[1.05] mb-6">
              <span className="text-white">Bring your audience</span>
              <br />
              <span className="text-orange-gradient">into the conversation.</span>
            </h1>

            <p className="text-lg sm:text-xl text-purple-200/90 mb-10 max-w-xl lg:max-w-none">
              Your audience asks, Echoes what resonates, and the best questions rise — in the room, tuned in live, or days ahead. No account needed to join.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 mb-4">
              <Link href="/create" className="btn-primary text-base px-8 py-3.5 w-full sm:w-auto">
                <SparkleIcon />
                Create a session
              </Link>
              <span className="text-brand-border hidden sm:block self-center">or</span>
              <form onSubmit={handleJoin} className="flex w-full sm:w-auto">
                <input
                  type="text"
                  value={code}
                  onChange={e => { setCode(e.target.value.toUpperCase()); setJoinError(null); }}
                  placeholder="Enter session code"
                  maxLength={12}
                  className="flex-1 sm:w-48 bg-brand-card border border-brand-border rounded-l-xl px-4 py-3.5
                             text-white text-sm font-medium
                             focus:outline-none focus:border-brand-purple transition-colors"
                />
                <button
                  type="submit"
                  disabled={joining || !code.trim()}
                  className="btn-primary rounded-l-none px-5 py-3.5 text-sm disabled:opacity-40"
                >
                  {joining ? '…' : 'Join'}
                </button>
              </form>
            </div>

            {joinError && <p className="text-red-400 text-sm mb-3">{joinError}</p>}

            <p className="text-purple-200/70 text-sm mb-4">
              Free to use · Join and ask without an account · Hosting takes a free account
            </p>

            <Link
              href="/demo"
              className="inline-flex items-center gap-1.5 min-h-[44px] text-brand-amber/70 hover:text-brand-amber text-sm font-medium transition-colors"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Try the interactive demo
              <span className="opacity-60">→</span>
            </Link>
          </div>

          {/* Right: animated Q&A widget */}
          <div className="w-full max-w-sm sm:max-w-md lg:w-[400px] xl:w-[440px] shrink-0">
            <MockQAWidget />
          </div>

        </div>
      </div>
    </section>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: <LinkIcon />,
    title: 'Host shares a link',
    desc: 'Spin up a session in seconds, then share the link or join code. Your audience is in — no signups, no downloads.',
  },
  {
    step: '02',
    icon: <QuestionIcon />,
    title: 'Your audience asks',
    desc: 'Anyone can ask, instantly. Everyone gets a handful of asks per session, so people bring the questions they really mean.',
  },
  {
    step: '03',
    icon: <EchoIconLg />,
    title: 'The best questions rise',
    desc: 'Attendees add Echoes to the questions they want answered. Whatever resonates climbs to the top — no shouting required.',
  },
];

function HowItWorks() {
  return (
    <section className="pt-10 pb-14 sm:py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>How it works</SectionLabel>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white text-center mb-3 sm:mb-4">
          Simple for everyone
        </h2>
        <p className="text-purple-200/80 text-center text-base sm:text-lg mb-8 sm:mb-16 max-w-xl mx-auto">
          Hosts see what their audience actually wants to talk about. Three steps, that&apos;s it.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="card p-7 relative overflow-hidden group hover:border-brand-purple/60 transition-colors">
              {/* Step number watermark */}
              <span className="absolute top-4 right-5 text-6xl font-extrabold text-brand-border/25 select-none leading-none">
                {item.step}
              </span>

              <div className="w-12 h-12 rounded-2xl bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center text-brand-orange mb-5 group-hover:bg-brand-orange/20 transition-colors">
                {item.icon}
              </div>

              <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
              <p className="text-purple-200/85 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

/**
 * Three, not six.
 *
 * The six cards were a third of the mobile page — 1,891px of 5,858, more than
 * two full screens — and six icon cards is the least-read pattern on a landing
 * page. These are the three a competitor does not have; the ones cut (real
 * time, moderation, mobile) are assumed rather than argued, so listing them
 * spent height without changing anybody's mind.
 */
const FEATURES = [
  {
    icon: <SimilarIcon />,
    title: 'Duplicate detection',
    desc: 'Before a question posts, attendees see similar ones already in the feed — and can Echo those instead of asking the same thing twice.',
  },
  {
    icon: <CreditIcon />,
    title: 'Paced, not rationed',
    desc: 'Everyone holds a few questions and Echoes at a time and earns one back every ten minutes. Enough friction that people post what they mean — and no ceiling on anyone who stays all day.',
  },
  {
    icon: <GuestIcon />,
    title: 'No account required',
    desc: 'Attendees jump straight in. An account is only needed to host or moderate a session.',
  },
];

function Features() {
  return (
    <section className="pt-10 pb-14 sm:py-24 px-4 border-t border-brand-border/40">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Features</SectionLabel>
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white text-center mb-3 sm:mb-4">
          Built for the way<br />shows actually run
        </h2>
        <p className="text-purple-200/80 text-center text-base sm:text-lg mb-8 sm:mb-16 max-w-xl mx-auto">
          AMAs, panels, radio, podcasts, classrooms — live in the room or listening anywhere.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 hover:border-brand-purple/50 transition-colors group">
              <div className="w-10 h-10 rounded-xl bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center text-brand-amber mb-4 group-hover:bg-brand-purple/30 transition-colors">
                {f.icon}
              </div>
              <h3 className="font-bold text-white mb-1">{f.title}</h3>
              <p className="text-purple-200/85 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Early access ─────────────────────────────────────────────────────────────

function EarlyAccess() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');

    const formUrl = process.env.NEXT_PUBLIC_WAITLIST_URL;
    if (!formUrl) {
      setTimeout(() => setStatus('done'), 600);
      return;
    }

    try {
      await fetch(formUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ EMAIL: email, email }).toString(),
      });
      setStatus('done');
    } catch {
      setStatus('done');
    }
  }

  return (
    <section className="py-12 px-4 border-t border-brand-border/40 overflow-hidden">
      <div className="max-w-xl mx-auto text-center relative">
        <div className="absolute left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-brand-orange/8 blur-[100px] pointer-events-none" />

        <div className="relative">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">
            Hosting tips &amp; updates
          </h2>
          <p className="text-purple-200/85 text-base mb-8">
            New features, session ideas, and hosting tips — straight to your inbox. No noise.
          </p>

          {status === 'done' ? (
            <div className="card px-8 py-10 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-brand-orange/20 border border-brand-orange/30 flex items-center justify-center text-brand-orange text-xl">
                ✓
              </div>
              <p className="text-white font-bold text-lg">You&apos;re in.</p>
              <p className="text-purple-200/75 text-sm">We&apos;ll send you the good stuff and nothing else.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 bg-brand-card border border-brand-border rounded-xl px-4 py-3.5
                           text-white text-sm
                           focus:outline-none focus:border-brand-purple transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="btn-primary px-7 py-3.5 text-sm whitespace-nowrap disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Subscribe →'}
              </button>
            </form>
          )}

          {status !== 'done' && (
            <p className="text-purple-200/60 text-xs mt-4">No spam. Unsubscribe anytime.</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────

function CTA() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => { setUser(getUser()); }, []);
  const signedIn = !!user && !user.is_guest;

  return (
    <section className="py-12 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <div className="relative card p-10 sm:p-14 overflow-hidden">
          <div className="absolute inset-0 bg-purple-gradient opacity-5 pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-40 bg-brand-orange/10 blur-3xl pointer-events-none" />

          <h2 className="relative text-4xl sm:text-5xl font-extrabold mb-4">
            <span className="text-orange-gradient">Ready to hear your audience?</span>
          </h2>
          <p className="relative text-purple-200/90 text-lg mb-8">
            Your first session takes under a minute to set up. Free, forever.
          </p>
          <div className="relative flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/create" className="btn-primary px-10 py-4 text-lg">
              <SparkleIcon />
              Create a session
            </Link>
            <Link
              href={signedIn ? '/dashboard' : '/login'}
              className="btn-ghost px-8 py-4 text-lg"
            >
              {signedIn ? 'Your sessions' : 'Sign in'}
            </Link>
          </div>

          <span className="absolute top-6 left-8 text-brand-purple text-xl select-none">✦</span>
          <span className="absolute bottom-8 right-10 text-brand-purple/60 text-lg select-none">✦</span>
          <span className="absolute top-10 right-16 text-brand-orange/40 text-sm select-none">✦</span>
        </div>
      </div>
    </section>
  );
}


// ─── Shared ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-brand-orange text-sm font-semibold uppercase tracking-widest text-center mb-3">
      {children}
    </p>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}
function EchoIconLg() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12l7-7 7 7" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function QuestionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function SimilarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function CreditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
function MobileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}
function GuestIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main className="overflow-x-hidden">
      <Nav />
      <Hero />
      {/* DemoStrip removed: the hero already carries a "Try the interactive
          demo" link 765px above where the strip sat, pointing at the same
          place. It was 326px spent restating a link the visitor had just
          scrolled past. */}
      <HowItWorks />
      <Features />
      <CTA />
      {/* Desktop only. It sits after the final call to action, and anyone who
          scrolled seven screens past that on a phone is not signing up for
          tips — it was 363px of a 5,858px page, spent on the least likely
          reader. */}
      <div className="hidden sm:block">
        <EarlyAccess />
      </div>
      <Footer />
    </main>
  );
}
