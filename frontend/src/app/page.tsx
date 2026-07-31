'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Session } from '@ask-away/shared/types';

// ─── Nav ────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-brand-border/50 backdrop-blur-md bg-brand-bg/80">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        <Logo />
        <div className="flex items-center gap-3">
          <Link href="/discover" className="btn-ghost text-sm py-2 px-4">
            Discover
          </Link>
          <Link href="/login" className="btn-ghost text-sm py-2 px-4">
            Sign in
          </Link>
          <Link href="/create" className="btn-primary text-sm py-2 px-4">
            Create session
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 select-none">
      {/* Inline SVG icon: sparkle + question bubble matching logo 2 */}
      <span className="text-xl font-bold tracking-tight text-orange-gradient leading-none">
        GuestSpeak
      </span>
    </Link>
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
    <section className="relative pt-32 pb-10 px-4 overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-brand-purple/20 blur-[120px] pointer-events-none" />
      <div className="absolute top-20 left-1/3 w-[300px] h-[300px] rounded-full bg-brand-orange/10 blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto text-center">
        {/* Logo */}
        <div className="mb-6">
          <span className="text-5xl sm:text-7xl font-display font-bold text-orange-gradient">
            GuestSpeak
          </span>
        </div>

        {/* Eyebrow */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-brand-purple/50 bg-brand-purple/10 text-brand-amber text-sm font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-amber animate-pulse-slow" />
          Live Audience Q&amp;A Platform
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold leading-tight mb-6">
          <span className="text-white">Give your audience</span>
          <br />
          <span className="text-orange-gradient">a voice.</span>
        </h1>

        <p className="text-lg sm:text-xl text-purple-200/70 max-w-2xl mx-auto mb-10">
          Let your audience ask questions, support their favorites, and help shape the conversation.
        </p>

        {/* Join / Create CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-3">
          <Link href="/create" className="btn-primary text-base px-8 py-3.5 w-full sm:w-auto">
            <SparkleIcon />
            Create a session
          </Link>
          <span className="text-brand-border hidden sm:block">or</span>
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

        <p className="text-brand-orange-dim text-sm mb-3">
          Free to use · No account needed to join sessions or ask questions · Account required to host
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

    </section>
  );
}

// ─── Live Now ────────────────────────────────────────────────────────────────

function LiveNow() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ live_now: Session[] }>('/discover')
      .then(r => setSessions(r.live_now.slice(0, 6)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (!loading && sessions.length === 0) return null;

  return (
    <section className="py-16 px-4 border-t border-brand-border/40">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              Live now
            </span>
            <h2 className="text-xl font-bold text-white">Happening right now</h2>
          </div>
          <Link href="/discover" className="text-sm text-brand-orange hover:text-brand-amber transition-colors font-medium">
            See all →
          </Link>
        </div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5 h-28 animate-pulse bg-brand-card/50" />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map(s => (
              <Link key={s.id} href={`/s/${s.slug}`} className="card p-5 flex flex-col gap-2 hover:border-brand-purple/50 transition-colors group">
                {(s as any).org_name && (
                  <p className="text-xs text-brand-orange/70 truncate">{(s as any).org_name}</p>
                )}
                <h3 className="font-bold text-white text-sm leading-snug group-hover:text-brand-amber transition-colors line-clamp-2">
                  {s.title}
                </h3>
                <div className="flex items-center justify-between text-xs text-purple-200/40 mt-auto pt-1">
                  <span>{s.host_username}</span>
                  <div className="flex items-center gap-2">
                    {(s as any).participant_count > 0 && (
                      <span>{(s as any).participant_count} joined</span>
                    )}
                    {s.city && <span>{s.city}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
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
    desc: 'Create a session in seconds. Share the link or code with your audience — no app install required.',
  },
  {
    step: '02',
    icon: <QuestionIcon />,
    title: 'Audience asks questions',
    desc: 'Anyone can submit a question instantly. Guests get up to 5 credits to spend on questions or Echoes.',
  },
  {
    step: '03',
    icon: <EchoIconLg />,
    title: 'Echoes surface the best',
    desc: 'Instead of upvotes, the crowd adds Echoes. The most-echoed questions float to the top automatically.',
  },
];

function HowItWorks() {
  return (
    <section className="py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <SectionLabel>How it works</SectionLabel>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white text-center mb-4">
          Simple for everyone
        </h2>
        <p className="text-brand-orange-dim text-center text-lg mb-16 max-w-xl mx-auto">
          Hosts get signal. Audiences get a voice. Three steps.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="card p-7 relative overflow-hidden group hover:border-brand-purple/60 transition-colors">
              {/* Step number — watermark */}
              <span className="absolute top-4 right-5 text-6xl font-extrabold text-brand-border/30 select-none leading-none">
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
    desc: 'Hosts assign moderators with granular permissions: star, hide, flag, or mark answered.',
  },
  {
    icon: <SimilarIcon />,
    title: 'Duplicate detection',
    desc: 'Before submitting, the audience sees similar questions already asked — keeping the feed clean.',
  },
  {
    icon: <CreditIcon />,
    title: 'Credit system',
    desc: 'Hosts can give guests up to 5 credits to spend on questions or Echoes. Quality over volume.',
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
          Everything you need,<br />nothing you don't
        </h2>
        <p className="text-brand-orange-dim text-center text-lg mb-16 max-w-xl mx-auto">
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

// To wire up email capture:
// 1. Mailchimp: copy your form's `action` URL and set NEXT_PUBLIC_WAITLIST_URL in Vercel
// 2. Beehiiv / ConvertKit / any other provider: same — paste the POST endpoint
// 3. If NEXT_PUBLIC_WAITLIST_URL is not set, the form shows a success state immediately
//    so the page looks great even before you've picked a provider.

function EarlyAccess() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');

    const formUrl = process.env.NEXT_PUBLIC_WAITLIST_URL;
    if (!formUrl) {
      // No endpoint configured yet — show success state anyway
      setTimeout(() => setStatus('done'), 600);
      return;
    }

    try {
      // Works with Mailchimp (application/x-www-form-urlencoded) and most providers
      await fetch(formUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ EMAIL: email, email }).toString(),
      });
      setStatus('done');
    } catch {
      setStatus('done'); // no-cors always throws — treat as success
    }
  }

  return (
    <section className="py-24 px-4 border-t border-brand-border/40">
      <div className="max-w-xl mx-auto text-center">
        {/* Glow */}
        <div className="absolute left-1/2 -translate-x-1/2 w-[500px] h-[200px] bg-brand-orange/8 blur-[100px] pointer-events-none" />

        <div className="relative">
          {/* Badge */}
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

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2 mt-10">
            {['Real-time Q&A', 'No app install needed', 'Free to start', 'Built for live events'].map(f => (
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
          {/* Background glow */}
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

          {/* Decorative sparkles */}
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
        <span className="text-brand-orange font-bold tracking-tight text-lg">GuestSpeak</span>
        <p className="text-purple-200/40 text-sm">© {new Date().getFullYear()} GuestSpeak. Built for live events.</p>
        <div className="flex gap-6 text-purple-200/50 text-sm">
          <span>Privacy & Terms coming soon</span>
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

// ─── Icons (inline SVG) ──────────────────────────────────────────────────────

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
    <main>
      <Nav />
      <Hero />
      <LiveNow />
      <HowItWorks />
      <Features />
      <EarlyAccess />
      <Footer />
    </main>
  );
}
