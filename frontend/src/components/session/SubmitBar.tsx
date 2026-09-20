'use client';

/**
 * The ask box, its credit meter, the anonymity toggle, and the similar-question
 * panel that offers an echo instead of a duplicate.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { plural } from '@/lib/plural';
import { api } from '@/lib/api';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';

export function SubmitBar({ body, setBody, credits, anonCredits, submitting, similarQuestions, echoedIds, onSubmit, onEchoSimilar, sessionStatus, isRegistered, postAnonymously, onToggleAnon, isMod, burstCooldown }: {
  body: string; setBody: (v: string) => void;
  credits: number; anonCredits: number; submitting: boolean;
  similarQuestions: Question[];
  echoedIds: Set<string>;
  onSubmit: () => void; onEchoSimilar: (id: string) => void;
  sessionStatus: string;
  isRegistered: boolean;
  postAnonymously: boolean;
  onToggleAnon: () => void;
  isMod?: boolean;
  burstCooldown?: number;
}) {
  const MAX = 300;
  const remaining = MAX - body.length;
  const effectiveCredits = postAnonymously ? anonCredits : credits;
  const canSubmit = body.trim().length > 0 && (isMod || effectiveCredits > 0) && !submitting && sessionStatus !== 'closed' && !burstCooldown;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-card border-t border-brand-border shadow-2xl pb-[env(safe-area-inset-bottom)]">
      {similarQuestions.length > 0 && (
        <div className="max-w-3xl mx-auto px-4 pt-3">
          <p className="text-xs text-brand-orange font-semibold mb-2">Similar questions already asked:</p>
          <div className="space-y-2 mb-3 max-h-[100px] sm:max-h-none overflow-y-auto">
            {similarQuestions.slice(0, 3).map(q => (
              <div key={q.id} className="flex items-center gap-3 bg-brand-card rounded-xl px-3 py-2 border border-brand-border/50">
                <p className="flex-1 text-xs text-purple-200/90 leading-snug">{q.body}</p>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-brand-amber font-bold">
                    {plural(q.vote_count, 'Echo', 'Echoes')}
                  </span>
                  {/* Already echoed says so, rather than offering the button
                      again. The feed card for the same question is highlighted,
                      so a live Echo button beside it invited a second press the
                      server would only refuse. */}
                  {echoedIds.has(q.id) ? (
                    <span className="text-xs text-brand-amber/80 border border-brand-amber/30 px-2 py-1 rounded-lg font-semibold">
                      ✓ Echoed
                    </span>
                  ) : (
                    <button
                      onClick={() => onEchoSimilar(q.id)}
                      className="text-xs bg-brand-orange/20 text-brand-orange border border-brand-orange/30 px-2 py-1 rounded-lg font-semibold hover:bg-brand-orange/30 transition-colors"
                    >
                      Echo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-3 flex gap-2 sm:gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
            placeholder={isMod || effectiveCredits > 0 ? 'Ask a question…' : postAnonymously ? 'Anonymous limit reached — post with your name to continue' : 'No credits remaining'}
            disabled={!isMod && effectiveCredits < 1}
            maxLength={300}
            rows={2}
            className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-3 pr-12
                       text-white text-base resize-none
                       focus:outline-none focus:border-brand-purple transition-colors disabled:opacity-40"
          />
          <span className={`absolute right-3 bottom-3 text-xs ${remaining < 50 ? 'text-red-400' : 'text-purple-200/85'}`}>
            {remaining} left
          </span>
        </div>
        <div className="flex flex-col items-end gap-2 self-end">
          {/* Anonymous toggle — registered users only, and not staff.
              A host or moderator asking anonymously in their own session is
              not a thing they should be able to do, and the accounting made
              it worse: elevated roles skip the credit path entirely, so their
              anonymous posts drew from no pool and were unlimited. The server
              refuses the flag from staff now; this just stops offering it. */}
          {isRegistered && !isMod && (
            <button
              type="button"
              onClick={onToggleAnon}
              title={postAnonymously ? 'Posting anonymously — tap to post as yourself' : 'Post anonymously'}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                postAnonymously
                  ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                  : 'bg-white/5 border-white/10 text-purple-200/85 hover:text-purple-200/90'
              }`}
            >
              {/* Mask icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" />
                <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" />
              </svg>
              {postAnonymously ? `Anon on (${anonCredits} left)` : 'Anon off'}
            </button>
          )}
          <button onClick={onSubmit} disabled={!canSubmit} className="btn-primary px-4 py-3 disabled:opacity-40 disabled:cursor-not-allowed min-w-[64px] text-center">
            {submitting ? '…' : burstCooldown ? `${burstCooldown}s` : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
