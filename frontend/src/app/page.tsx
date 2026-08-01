'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Nav ────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-brand-border/50 backdrop-blur-md bg-brand-bg/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Logo />
        <div className="flex items-center gap-2">
          <Link href="/discover" className="hidden sm:block btn-ghost text-sm py-2 px-4">
            Discover
          </Link>
          <Link href="/login" className="btn-ghost text-sm py-2 px-4">
            Sign in
          </Link>
          <Link href="/create" className="btn-primary text-sm py-2 px-4">
            <span className="sm:hidden">Create</span>
            <span className="hidden sm:inline">Create session</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 select-none">
      <span className="font-display text-xl font-bold tracking-tight leading-none">
        Guest<span className="text-brand-orange">Speak</span>
      </span>
    </Link>
  );
}

// ─── Mock Q&A Widget ─────────────────────────────────────────────────────────

const MOCK_QUESTIONS = [
  { text: "What's one thing you wish you'd known before building your first AI product?", author: "Jordan M.", ago: "2m", top: true },
  { text: "How do you keep your team focused when the tools are changing this fast?", author: "Priya K.", ago: "4m", top: false },
  { text: "What does good human-AI collaboration actually look like day to day?", author: "anon", ago: "6m", top: false },
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
  const DEMO_TEXT = 'How is your team getting the most out of AI tools?';
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
            <span className="text-white text-sm font-semibold truncate">AI &amp; The Future of Work</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 text-purple-200/40 text-xs">
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
              <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                    i === 0
                      ? 'bg-brand-orange/20 text-brand-orange border border-brand-orange/30'
                      : 'bg-brand-bg text-purple-200/40 border border-brand-border/40'
                  } ${flash === i ? 'scale-110' : ''}`}
                >
                  ↑
                </div>
                <span
                  className={`text-xs font-bold tabular-nums transition-all duration-300 ${
                    flash === i ? 'text-brand-orange scale-110' : i === 0 ? 'text-brand-amber' : 'text-purple-200/50'
                  }`}
                >
                  {echoes[i]}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {q.top && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-bold text-brand-orange uppercase tracking-wider">★ Top question</span>
                  </div>
                )}
                <p className="text-white text-xs leading-relaxed">{q.text}</p>
                <p className="text-purple-200/35 text-[10px] mt-1.5">{q.author} · {q.ago} ago</p>
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
          <div className="flex items-center justify-between mt-2 px-0.5">
            <span className="text-purple-200/30 text-[10px]">3 credits remaining</span>
            <span className="text-purple-200/30 text-[10px]">Ask anonymously</span>
          </div>
        </div>
      </div>

      {/* Floating echo notification */}
      {flash !== null && (
        <div
          key={`flash-${flash}-${echoes[flash]}`}
          className="absolute -right-3 top-1/3 bg-brand-orange text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg pointer-events-none"
          style={{ animation: 'floatBadge 0.7s ease-out forwards' }}
        >
          +1 echo
        </div>
      )}

      <style>{`
        @keyframes floatBadge {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-24px) scale(0.9); }
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
      setJoinError('No session found with that code.');
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
              Live Audience Q&amp;A Platform
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl xl:text-7xl font-extrabold leading-[1.05] mb-6">
              <span className="text-white">Give your audience</span>
              <br />
              <span className="text-orange-gradient">a voice.</span>
            </h1>

            <p className="text-lg sm:text-xl text-purple-200/70 mb-10 max-w-xl lg:max-w-none">
              Real-time Q&amp;A where the crowd surfaces the best questions — no account needed to join, no friction.
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
                             text-white placeholder-brand-border text-sm font-medium
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

            <p className="text-purple-200/40 text-sm mb-4">
              Free to use · No account needed to join or ask · Account required to host
            </p>

            <Link
              href="/demo"
              className="inline-flex items-center gap-1.5 text-brand-amber/70 hover:text-brand-amber text-sm font-medium transition-colors"
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

// ─── Demo Strip ──────────────────────────────────────────────────────────────

function DemoStrip() {
  return (
    <section className="py-10 px-4 border-y border-brand-border/40">
      <div className="max-w-6xl mx-auto">
        <div className="rounded-2xl bg-gradient-to-r from-brand-orange/10 via-brand-purple/10 to-brand-orange/5 border border-brand-orange/20 px-6 sm:px-10 py-7 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-xs text-brand-orange font-semibold uppercase tracking-widest mb-1">Interactive demo</p>
            <p className="text-white font-bold text-lg leading-snug">See the full audience experience</p>
            <p className="text-purple-200/55 text-sm mt-1">Submit questions, add Echoes, and watch the feed update in real time — no account needed.</p>
          </div>
          <Link
            href="/demo"
            className="btn-primary px-8 py-3.5 shrink-0 whitespace-nowrap text-sm"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse mr-1.5" />
            Try the demo →
          </Link>
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
    desc: 'Create a session in seconds. Share the link or join code with your audience — no signup required to join.',
  },
  {
    step: '02',
    icon: <QuestionIcon />,
    title: 'Audience asks questions',
    desc: 'Anyone can submit a question instantly. Each person gets a handful of asks — encouraging quality over quantity.',
  },
  {
    step: '03',
    icon: <EchoIconLg />,
    title: 'Best questions rise to the top',
    desc: 'The audience adds Echoes to questions they want answered. The most-supported questions automatically move to the top.',
  },
];

function HowItWorks() {
  return (
    <section className="py-20 px-4">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>How it works</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white text-center mb-4">
          Simple for everyone
        </h2>
        <p className="text-purple-200/55 text-center text-lg mb-16 max-w-xl mx-auto">
          Hosts see what the room actually wants to talk about. Three steps, that's it.
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
              <p className="text-purple-200/60 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <BoltIcon />,
    title: 'Real-time, always',
    desc: 'Questions and Echoes appear live for everyone in the session — no refresh needed.',
  },
  {
    icon: <ShieldIcon />,
    title: 'Moderation built in',
    desc: 'Pin important questions, hide off-topic ones, and mark questions answered — all from a simple host dashboard.',
  },
  {
    icon: <SimilarIcon />,
    title: 'Duplicate detection',
    desc: 'Before posting, audiences see similar questions already in the feed — so the same question doesn\'t get asked five times.',
  },
  {
    icon: <CreditIcon />,
    title: 'Credit system',
    desc: 'Each guest gets a limited number of questions and Echoes to spend — so people think before they post, and the best questions win.',
  },
  {
    icon: <MobileIcon />,
    title: 'Mobile first',
    desc: 'Designed for the phone in your audience\'s hand. Fast, thumb-friendly, no friction.',
  },
  {
    icon: <GuestIcon />,
    title: 'No account required',
    desc: 'Guests jump straight in. Registration is only needed to host or moderate a session.',
  },
];

function Features() {
  return (
    <section className="py-24 px-4 border-t border-brand-border/40">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>Features</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white text-center mb-4">
          Everything you need,<br />nothing you don&apos;t
        </h2>
        <p className="text-purple-200/55 text-center text-lg mb-16 max-w-xl mx-auto">
          Built for live events, conferences, AMAs, classrooms, and anywhere questions matter.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 hover:border-brand-purple/50 transition-colors group">
              <div className="w-10 h-10 rounded-xl bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center text-brand-amber mb-4 group-hover:bg-brand-purple/30 transition-colors">
                {f.icon}
              </div>
              <h3 className="font-bold text-white mb-1">{f.title}</h3>
              <p className="text-purple-200/60 text-sm leading-relaxed">{f.desc}</p>
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
    <section className="py-24 px-4 border-t border-brand-border/40">
      <div className="max-w-xl mx-auto text-center relative">
        <div className="absolute left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-brand-orange/8 blur-[100px] pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-brand-orange/30 bg-brand-orange/10 text-brand-amber text-sm font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-pulse-slow" />
            Launching soon
          </div>

          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-4">
            Be first to know
          </h2>
          <p className="text-purple-200/60 text-lg mb-10">
            GuestSpeak is almost ready. Drop your email and we&apos;ll reach out when we launch.
          </p>

          {status === 'done' ? (
            <div className="card px-8 py-10 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-brand-orange/20 border border-brand-orange/30 flex items-center justify-center text-brand-orange text-xl">
                ✓
              </div>
              <p className="text-white font-bold text-lg">You&apos;re on the list.</p>
              <p className="text-purple-200/50 text-sm">We&apos;ll be in touch when GuestSpeak launches.</p>
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
                           text-white placeholder-brand-border/60 text-sm
                           focus:outline-none focus:border-brand-purple transition-colors"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="btn-primary px-7 py-3.5 text-sm whitespace-nowrap disabled:opacity-60"
              >
                {status === 'loading' ? 'Sending…' : 'Notify me →'}
              </button>
            </form>
          )}

          {status !== 'done' && (
            <p className="text-purple-200/30 text-xs mt-4">No spam. One email when we launch.</p>
          )}

          <div className="flex flex-wrap justify-center gap-2 mt-10">
            {['Real-time Q&A', 'Works in any browser', 'Free to start', 'Built for live events'].map(f => (
              <span key={f} className="px-3 py-1.5 rounded-full border border-brand-border text-purple-200/50 text-xs">
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── CTA ─────────────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="py-24 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <div className="relative card p-10 sm:p-14 overflow-hidden">
          <div className="absolute inset-0 bg-purple-gradient opacity-5 pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-40 bg-brand-orange/10 blur-3xl pointer-events-none" />

          <h2 className="relative text-4xl sm:text-5xl font-extrabold mb-4">
            <span className="text-orange-gradient">Ready to go?</span>
          </h2>
          <p className="relative text-purple-200/70 text-lg mb-8">
            Create your first session in under a minute. Free, forever.
          </p>
          <div className="relative flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/create" className="btn-primary px-10 py-4 text-lg">
              <SparkleIcon />
              Create a session
            </Link>
            <Link href="/login" className="btn-ghost px-8 py-4 text-lg">
              Sign in
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

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-brand-border/40 py-8 px-4">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="font-display font-bold tracking-tight text-lg">Guest<span className="text-brand-orange">Speak</span></span>
        <p className="text-purple-200/40 text-sm">© {new Date().getFullYear()} GuestSpeak. Built for live events.</p>
        <div className="flex gap-6 text-purple-200/50 text-sm">
          <span>Privacy &amp; Terms coming soon</span>
        </div>
      </div>
    </footer>
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
      <DemoStrip />
      <HowItWorks />
      <Features />
      <EarlyAccess />
      <CTA />
      <Footer />
    </main>
  );
}
