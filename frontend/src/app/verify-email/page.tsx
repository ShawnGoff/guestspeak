'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { AuthShell } from '@/components/AuthShell';

function VerifyEmailForm() {
  const token = useSearchParams().get('token');
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState<string | null>(token ? null : 'This link is not valid. Request a new one from Settings.');

  // A button rather than verifying on load: mail security scanners open every
  // link in a message, and should not be able to confirm an address for you.
  async function confirm() {
    setLoading(true); setError(null);
    try {
      await api.post('/auth/verify-email', { token });
      setDone(true);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Confirm your email"
      subtitle="One click and we will know this address is yours."
      footer={<>Back to <Link href="/dashboard" className="text-brand-orange hover:text-brand-amber">your dashboard</Link></>}
    >
      {done ? (
        <div className="text-center py-4">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-white font-semibold">Email confirmed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 text-red-400 text-sm rounded-xl px-4 py-3">{error}</div>
          )}
          <button onClick={confirm} disabled={loading || !token} className="btn-primary w-full py-3 text-sm disabled:opacity-40">
            {loading ? 'Confirming…' : 'Confirm email address'}
          </button>
        </div>
      )}
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
