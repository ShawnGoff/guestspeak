'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveAuth, safeNext } from '@/lib/auth';
import { AuthShell, Field, ErrorMsg } from '@/components/AuthShell';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: any }>('/auth/login', { email, password });
      saveAuth(res.token, res.user);
      // Go to dashboard or wherever they were headed
      router.push(safeNext(new URLSearchParams(window.location.search).get('next')));
    } catch (err: any) {
      setError(err.message ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  const next = typeof window !== 'undefined'
    ? safeNext(new URLSearchParams(window.location.search).get('next'), '')
    : '';
  // Encoded, unlike before: an unencoded value carrying & or # would be read as
  // further query parameters on the register URL rather than as the path.
  const registerHref = `/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <AuthShell
      title="Take the mic"
      subtitle="Sign in or create a free account — you only need one to host or moderate."
      footer={<>Just joining a session? <Link href="/discover" className="text-brand-orange hover:text-brand-amber">Browse sessions →</Link></>}
    >
      {/* Primary CTA for new users */}
      <Link href={registerHref} className="btn-primary w-full py-3 text-sm text-center block mb-4">
        Create a free account
      </Link>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-brand-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-brand-card px-3 text-xs text-purple-200/70">already have one? sign in</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email or username" type="text" value={email} onChange={setEmail} placeholder="you@example.com or @handle" />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-purple-200/85">Password</label>
            <Link href="/forgot-password" className="text-xs text-brand-orange hover:text-brand-amber transition-colors">Forgot password?</Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-brand-purple transition-colors"
          />
        </div>

        {error && <ErrorMsg message={error} />}

        <button type="submit" disabled={loading} className="btn-ghost w-full py-3 text-sm">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Register page ────────────────────────────────────────────────────────────

// ─── Shared components ────────────────────────────────────────────────────────
