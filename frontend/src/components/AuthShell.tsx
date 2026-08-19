'use client';

// Shared chrome for the auth pages (login, register, forgot/reset password).
// These live here rather than in a page module: the App Router only allows a
// page file to export a default component and a fixed set of route config
// keys, so re-exporting components from one broke the type-checked build.

import Link from 'next/link';

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
            <span className="text-3xl font-bold tracking-tight text-white">Guest<span className="text-brand-orange">Speak</span></span>
          </Link>
        </div>

        {/* Card */}
        <div className="card p-7">
          <h1 className="text-xl font-bold text-white mb-1">{title}</h1>
          <p className="text-purple-200/75 text-sm mb-6">{subtitle}</p>
          {children}
        </div>

        <p className="text-center text-sm text-purple-200/70 mt-5">{footer}</p>
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
      <label className="block text-xs font-semibold text-purple-200/85 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3
                   text-white text-sm
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
