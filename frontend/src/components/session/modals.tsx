'use client';

/**
 * The two dialogs the session page can raise: a host replying to a question,
 * and anyone reporting the session itself.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { plural } from '@/lib/plural';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';

// ─── Reply modal ──────────────────────────────────────────────────────────────

export function ReplyModal({ question, reply, loading, onChange, onSubmit, onClose }: {
  question: Question;
  reply: string;
  loading: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-6 sm:pb-0">
      <div className="card p-6 w-full max-w-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-white">Host reply</h2>
          <button onClick={onClose} className="text-purple-200/85 hover:text-white transition-colors p-1" aria-label="Close">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <p className="text-purple-200/90 text-sm mb-4 line-clamp-2">{question.body}</p>
        <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>
          <textarea
            value={reply}
            onChange={e => onChange(e.target.value)}
            placeholder="Write your reply…"
            rows={3}
            maxLength={2000}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 text-base resize-none focus:outline-none focus:border-brand-purple transition-colors mb-4"
          />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="btn-ghost text-sm py-2.5 px-4">Cancel</button>
            <button type="submit" disabled={loading || !reply.trim()} className="btn-primary text-sm py-2.5 px-5 disabled:opacity-40">
              {loading ? 'Saving…' : 'Save reply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Submit bar ───────────────────────────────────────────────────────────────

export const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'spam',           label: 'Spam or self-promotion' },
  { value: 'inappropriate',  label: 'Inappropriate content' },
  { value: 'impersonation',  label: 'Impersonation' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'other',          label: 'Other' },
];

export function ReportSessionModal({ onSubmit, onClose }: {
  onSubmit: (reason: string, details: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setLoading(true);
    try {
      await onSubmit(reason, details.trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-brand-card border border-white/10 rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-white mb-1">Report this session</h2>
        <p className="text-xs text-purple-200/60 mb-4">Our team will review your report. Thank you for helping keep things safe.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            {REPORT_REASONS.map(r => (
              <label key={r.value} className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="accent-brand-orange"
                />
                <span className="text-sm text-purple-100/80 group-hover:text-white transition-colors">{r.label}</span>
              </label>
            ))}
          </div>

          <div>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value.slice(0, 500))}
              placeholder="Additional details (optional)"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-brand-orange/50"
            />
            <p className="text-xs text-purple-200/40 text-right mt-0.5">{details.length}/500</p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-purple-200/70 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reason || loading}
              className="px-4 py-1.5 text-sm bg-red-700/80 hover:bg-red-600/80 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {loading ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
