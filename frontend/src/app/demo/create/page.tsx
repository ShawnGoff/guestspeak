'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function DemoCreatePage() {
  const router = useRouter();
  const [title, setTitle]           = useState('');
  const [desc, setDesc]             = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [credits, setCredits]       = useState(3);
  const [startNow, setStartNow]     = useState(true);
  const [launching, setLaunching]   = useState(false);

  function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLaunching(true);
    const params = new URLSearchParams({
      host: 'true',
      title: title.trim(),
      credits: String(credits),
    });
    setTimeout(() => {
      router.push(`/demo/session?${params.toString()}`);
    }, 800);
  }

  return (
    <div className="min-h-screen bg-brand-bg text-white">

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
            <Link href="/demo" className="px-3 py-1.5 rounded-lg text-white/35 hover:text-white/70 transition-colors font-medium">
              Discover
            </Link>
            <span className="text-white/20 mx-1">→</span>
            <span className="px-3 py-1.5 rounded-lg bg-brand-orange/10 text-brand-orange font-semibold">
              Create
            </span>
            <span className="text-white/20 mx-1">→</span>
            <span className="px-3 py-1.5 rounded-lg text-white/20 font-medium">
              Session
            </span>
          </nav>

          <Link href="/demo" className="text-white/40 hover:text-white/70 text-sm font-medium transition-colors">
            ← Back
          </Link>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-12">

        {/* Title */}
        <div className="mb-10">
          <p className="text-brand-orange text-sm font-semibold uppercase tracking-widest mb-2">Step 2 of 3</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-2">Create a session</h1>
          <p className="text-purple-200/50">Set up your session — you'll land in the Q&amp;A as the host.</p>
        </div>

        <form onSubmit={handleLaunch} className="flex flex-col gap-7">

          {/* Session Title */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-2">
              Session title <span className="text-brand-orange">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Q3 Product Roadmap AMA"
              maxLength={80}
              className="w-full bg-brand-card border border-brand-border rounded-xl px-4 py-3.5
                         text-white placeholder-brand-border/60 text-base
                         focus:outline-none focus:border-brand-purple transition-colors"
            />
            <p className="text-white/25 text-xs mt-1.5">{80 - title.length} characters remaining</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-2">
              Description <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What's this session about? Give your audience some context."
              rows={3}
              maxLength={300}
              className="w-full bg-brand-card border border-brand-border rounded-xl px-4 py-3.5
                         text-white placeholder-brand-border/60 text-sm resize-none
                         focus:outline-none focus:border-brand-purple transition-colors"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-3">Visibility</label>
            <div className="grid grid-cols-2 gap-3">
              {(['public', 'unlisted'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`flex flex-col items-start gap-1.5 p-4 rounded-xl border transition-all ${
                    visibility === v
                      ? 'border-brand-orange/60 bg-brand-orange/10'
                      : 'border-brand-border hover:border-brand-purple/40 bg-brand-card'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                      visibility === v ? 'border-brand-orange' : 'border-brand-border'
                    }`}>
                      {visibility === v && <div className="w-2 h-2 rounded-full bg-brand-orange" />}
                    </div>
                    <span className="text-sm font-semibold text-white capitalize">{v}</span>
                  </div>
                  <p className="text-xs text-white/40 text-left leading-relaxed">
                    {v === 'public'
                      ? 'Listed on Discover. Anyone can find and join.'
                      : 'Only people with the link or code can join.'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Credits Per Guest */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1">
              Credits per guest
            </label>
            <p className="text-white/35 text-xs mb-4">
              Each credit lets a guest ask a question or echo one. Quality over volume.
            </p>
            <div className="bg-brand-card border border-brand-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-3xl font-black text-white">{credits}</span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCredits(n)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        n <= credits
                          ? 'border-brand-orange bg-brand-orange/20 text-brand-orange'
                          : 'border-brand-border bg-transparent text-white/20'
                      }`}
                    >
                      <span className="text-xs font-bold">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-between text-xs text-white/30">
                <span>1 = curated, focused</span>
                <span>5 = open, high volume</span>
              </div>
            </div>
          </div>

          {/* When */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-3">When</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Start now', desc: 'Go live immediately', value: true },
                { label: 'Schedule', desc: 'Set a future date & time', value: false },
              ].map(opt => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => setStartNow(opt.value)}
                  className={`flex flex-col items-start gap-1.5 p-4 rounded-xl border transition-all ${
                    startNow === opt.value
                      ? 'border-brand-orange/60 bg-brand-orange/10'
                      : 'border-brand-border hover:border-brand-purple/40 bg-brand-card'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                      startNow === opt.value ? 'border-brand-orange' : 'border-brand-border'
                    }`}>
                      {startNow === opt.value && <div className="w-2 h-2 rounded-full bg-brand-orange" />}
                    </div>
                    <span className="text-sm font-semibold text-white">{opt.label}</span>
                  </div>
                  <p className="text-xs text-white/40 text-left">{opt.desc}</p>
                </button>
              ))}
            </div>
            {!startNow && (
              <div className="mt-3 flex gap-3">
                <input
                  type="date"
                  className="flex-1 bg-brand-card border border-brand-border rounded-xl px-4 py-3
                             text-white text-sm focus:outline-none focus:border-brand-purple transition-colors"
                />
                <input
                  type="time"
                  className="w-32 bg-brand-card border border-brand-border rounded-xl px-4 py-3
                             text-white text-sm focus:outline-none focus:border-brand-purple transition-colors"
                />
              </div>
            )}
          </div>

          {/* Preview */}
          {title && (
            <div className="rounded-xl border border-brand-purple/30 bg-brand-purple/5 p-4">
              <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Preview</p>
              <div className="flex items-center gap-2 mb-1">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  LIVE
                </span>
                <span className="text-xs text-white/30">{visibility === 'public' ? 'Public' : 'Unlisted'}</span>
              </div>
              <p className="font-bold text-white">{title}</p>
              <p className="text-xs text-white/40 mt-1">{credits} credit{credits !== 1 ? 's' : ''} per guest · Starts {startNow ? 'immediately' : 'at scheduled time'}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!title.trim() || launching}
            className={`w-full py-4 rounded-xl text-base font-bold transition-all ${
              title.trim() && !launching
                ? 'bg-orange-gradient text-white shadow-orange-glow hover:brightness-110 active:scale-[0.98]'
                : 'bg-brand-card border border-brand-border text-white/20 cursor-default'
            }`}
          >
            {launching ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Launching session…
              </span>
            ) : (
              '🎤 Launch session →'
            )}
          </button>

          <p className="text-center text-white/25 text-xs -mt-3">
            This is a demo — no account needed, nothing is saved.
          </p>

        </form>
      </main>
    </div>
  );
}
