'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveAuth } from '@/lib/auth';
import { AuthShell, Field, ErrorMsg } from '@/app/login/page';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('Those passwords don\'t match — give it another try.'); return; }
    if (password.length < 8)  { setError('Passwords need at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await api.post<{ token: string; user: any }>('/auth/register', {
        email, username, password,
      });
      saveAuth(res.token, res.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, forever — and only needed if you're hosting or moderating."
      footer={<>Already have one? <Link href="/login" className="text-brand-orange hover:text-brand-amber">Sign in</Link></>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <Field label="Username" type="text" value={username} onChange={setUsername} placeholder="yourname" />
        <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="8+ characters" />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" />

        {error && <ErrorMsg message={error} />}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-xs text-purple-200/60 mt-5">
        Just joining a session? You don&apos;t need an account for that.
      </p>
    </AuthShell>
  );
}
