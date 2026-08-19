'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

/**
 * Join-by-code, always within reach.
 *
 * The code is the only way into an unlisted session, and it is read out on air
 * — so someone arriving with one in their head should not have to hunt for the
 * box. It lives on the home page and on Discover, but nowhere else, which meant
 * hearing a code while on any other page sent you looking for it.
 *
 * Hidden below `sm`: at that width it would crowd out the logo and the primary
 * action, and both of those pages still carry a full-size version.
 */
export default function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const session = await api.get<{ slug: string }>(`/sessions/code/${trimmed.toUpperCase()}`);
      router.push(`/s/${session.slug}`);
    } catch {
      // Inline rather than a message: there is no room for one here, and the
      // full-size boxes elsewhere explain it properly.
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="hidden sm:flex items-center">
      <input
        value={code}
        onChange={e => { setCode(e.target.value); setFailed(false); }}
        placeholder="Join code"
        aria-label="Enter a session join code"
        aria-invalid={failed}
        maxLength={12}
        className={`w-28 bg-brand-card border rounded-l-lg px-3 py-1.5 text-sm text-white uppercase tracking-wide
          placeholder:normal-case placeholder:tracking-normal
          outline-none transition-colors
          ${failed ? 'border-red-400/70' : 'border-brand-border focus:border-brand-orange'}`}
      />
      <button
        type="submit"
        disabled={!code.trim() || busy}
        className="border border-l-0 border-brand-border rounded-r-lg px-3 py-1.5 text-sm font-semibold
          text-purple-200/90 hover:text-white hover:border-brand-orange disabled:opacity-40
          disabled:hover:text-purple-200/90 disabled:hover:border-brand-border transition-colors"
      >
        {busy ? '…' : 'Join'}
      </button>
    </form>
  );
}
