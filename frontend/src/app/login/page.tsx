'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveAuth } from '@/lib/auth';

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
      const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard';
      router.push(next);
    } catch (err: any) {
      setError(err.message ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  const next = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('next') ?? ''
    : '';
  const registerHref = `/register${next ? `?next=${next}` : ''}`;

  return (
    <AuthShell
      title="Host or join a session"
      subtitle="Create a free account or sign in to get started."
      footer={<>Just here to ask questions? <Link href="/" className="text-brand-orange hover:text-brand-amber">Continue as guest</Link></>}
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
          <span className="bg-brand-card px-3 text-xs text-purple-200/40">already have an account?</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email or username" type="text" value={email} onChange={setEmail} placeholder="you@example.com or @handle" />
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-purple-200/60">Password</label>
            <Link href="/forgot-password" className="text-xs text-brand-orange hover:text-brand-amber transition-colors">Forgot password?</Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-white text-sm placeholder-brand-border/60 focus:outline-none focus:border-brand-purple transition-colors"
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

export function RegisterPage() { return null; } // exported below in register/page.tsx

// ─── Shared components ────────────────────────────────────────────────────────

export function AuthShell({ title, subtitle, children, footer }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-brand-bg flex flex-col items-center justify-center px-4">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full bg-brand-purple/15 blur-[100px] pointer-events-none" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block">
            <span className="text-3xl font-bold tracking-tight text-orange-gradient">GuestSpeak</span>
          </Link>
        </div>

        {/* Card */}
        <div className="card p-7">
          <h1 className="text-xl font-bold text-white mb-1">{title}</h1>
          <p className="text-purple-200/50 text-sm mb-6">{subtitle}</p>
          {children}
        </div>

        <p className="text-center text-sm text-purple-200/40 mt-5">{footer}</p>
      </div>
    </div>
  );
}

export function Field({ label, type, value, onChange, placeholder }: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-purple-200/60 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3
                   text-white text-sm placeholder-brand-border/60
                   focus:outline-none focus:border-brand-purple transition-colors"
      />
    </div>
  );
}

export function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl px-4 py-3">
      {message}
    </div>
  );
}
