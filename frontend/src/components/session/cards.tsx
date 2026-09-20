'use client';

/**
 * The question cards, and the moderator button they share.
 *
 * FeaturedQuestionCard is the one that carries the top question. Its key is
 * load-bearing: without it React reused the component instance when a new
 * question took the slot, and a half-typed follow-up moved to a question its
 * author had never seen.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { plural } from '@/lib/plural';
import { api } from '@/lib/api';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';
import {
  EDIT_WINDOW_SECS, useInlineEdit, InlineEditForm, EditAffordance, FollowUpThread,
} from '@/components/session/inline-edit';
import type { InlineEdit } from '@/components/session/inline-edit';

// ─── Status badge ─────────────────────────────────────────────────────────────

/**
 * Holds a card on screen for one collapse before React unmounts it.
 *
 * Two elements, both needed: the outer animates its single grid track from 1fr
 * to 0fr — the one way to transition to a content-derived height without
 * measuring it in JS — and the inner clips its content while that happens. The
 * rules are in globals.css, and neither element does anything until `leaving`.
 */
export function Collapsible({ leaving, children }: { leaving: boolean; children: React.ReactNode }) {
  return (
    <div className={`gs-collapse ${leaving ? 'is-leaving' : ''}`}>
      <div>{children}</div>
    </div>
  );
}

export function FeaturedQuestionCard({ question, isEchoed, isMine, canAffordEcho, onEcho,
  hostView, onStar, onAnswered, onHide, onPin, onSpotlight, onReply,
  onMute, onRemove, editSecondsLeft = 0, onEditSave,
  canFollowUp = false, onFollowUp, replies = [] }: {
  question: Question & { is_pinned?: boolean; is_spotlighted?: boolean };
  isEchoed: boolean; isMine: boolean;
  /** Whether this viewer may spend on an echo — staff always can. */
  canAffordEcho: boolean;
  onEcho: () => void; hostView: boolean;
  onStar: () => void; onAnswered: () => void; onHide: () => void;
  onPin: () => void; onSpotlight: () => void; onReply: () => void;
  onMute?: () => void; onRemove?: () => void;
  editSecondsLeft?: number;
  onEditSave?: (body: string) => Promise<void>;
  canFollowUp?: boolean;
  onFollowUp?: (body: string) => Promise<void>;
  replies?: Question[];
}) {
  const canEcho = !isEchoed && !isMine && canAffordEcho && question.status !== 'hidden';
  const isSpotlighted = !!question.is_spotlighted;
  const edit = useInlineEdit(question, editSecondsLeft, onEditSave);

  return (
    <div className={`rounded-2xl border p-5 shadow-[0_0_30px_rgba(245,146,30,0.12)] ${
      isSpotlighted ? 'border-amber-400/60 bg-amber-500/5' : 'border-brand-orange/50 bg-brand-orange/5'
    }`}>
      {isSpotlighted && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-amber-300 tracking-wide">🎙 NOW ANSWERING</span>
        </div>
      )}
      {!isSpotlighted && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold text-brand-orange tracking-wide">🔥 TOP QUESTION</span>
        </div>
      )}

      <div className="flex gap-4 sm:gap-6">
        {/* Body */}
        <div className="flex-1 min-w-0">
          {edit.editing
            ? <div className="mb-3"><InlineEditForm edit={edit} /></div>
            : <p className="text-base sm:text-lg font-bold text-white leading-snug mb-3">{question.body}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            {question.status === 'answered' && (
              <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">✓ ANSWERED</span>
            )}
            {isMine && <span className="text-xs text-brand-orange/60 font-medium">Your question</span>}
            {question.edited_at && <span className="text-xs text-purple-200/50 italic">edited</span>}
            <EditAffordance edit={edit} />
            {question.author_username && (
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/85'}`}>
                {question.author_username}
              </span>
            )}
          </div>
          {question.host_reply && (
            <div className="mt-3 pl-3 border-l-2 border-brand-orange/40">
              <p className="text-xs text-brand-orange/70 font-semibold mb-1">Host reply</p>
              <p className="text-sm text-purple-200/80">{question.host_reply}</p>
            </div>
          )}
          <FollowUpThread replies={replies} canFollowUp={canFollowUp} onFollowUp={onFollowUp} />
          {hostView && (
            <div className="mt-4 pt-3 border-t border-brand-border/30 space-y-2">
              <div className="flex items-center gap-2">
                <button onClick={onSpotlight} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${isSpotlighted ? 'bg-amber-500/20 border-amber-400/50 text-amber-300' : 'border-brand-border/60 text-purple-200/90 hover:border-amber-400/40 hover:text-amber-300'}`}>🎙 Now Answering</button>
                <button onClick={onStar} className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'starred' ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400' : 'border-brand-border/60 text-purple-200/85 hover:text-yellow-400'}`}>★ Star</button>
                <button onClick={onAnswered} className={`text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${question.status === 'answered' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400' : 'border-brand-border/60 text-purple-200/85 hover:text-emerald-400'}`}>{question.status === 'answered' ? '✓ Answered' : '✓ Answered'}</button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={question.is_pinned ? 'Unpin' : 'Pin'} active={!!question.is_pinned}>{question.is_pinned ? 'Unpin' : 'Pin'}</ModButton>
                <ModButton onClick={onHide} title="Hide question" danger={question.status !== 'hidden'} active={question.status === 'hidden'}>{question.status === 'hidden' ? 'Unhide' : 'Hide'}</ModButton>
                <ModButton onClick={onReply} title="Reply">Reply</ModButton>
                {onMute && <ModButton onClick={onMute} title={question.author_is_muted ? 'Unmute user' : 'Mute user'} active={!!question.author_is_muted} danger={!question.author_is_muted}>{question.author_is_muted ? 'Unmute User' : 'Mute User'}</ModButton>}
                {onRemove && <ModButton onClick={() => { if (confirm('Remove this person from the session?')) onRemove!(); }} title="Remove user" danger>Remove User</ModButton>}
              </div>
            </div>
          )}
        </div>

        {/* Echo button */}
        <div className="shrink-0 flex flex-col items-center gap-2 min-w-[68px]">
          <button
            onClick={onEcho}
            disabled={!canEcho}
            className={`w-full flex flex-col items-center gap-1 px-3 py-3 rounded-xl border transition-all active:scale-95 ${
              isEchoed
                ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                : canEcho
                ? 'border-brand-border text-purple-200/90 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/70 cursor-not-allowed'
            }`}
          >
            <span className="text-xl font-black leading-none">↑</span>
            <span className="text-2xl font-black leading-none">{question.vote_count}</span>
            <span className="text-[10px] font-semibold tracking-wide opacity-60">
              {question.vote_count === 1 ? 'echo' : 'echoes'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

// ─── Question card ────────────────────────────────────────────────────────────

export function QuestionCard({ question, isEchoed, isMine, canAffordEcho, onEcho,
  hostView, onStar, onAnswered, onHide, onPin, onSpotlight, onReply,
  onMute, onRemove, editSecondsLeft = 0, onEditSave,
  canFollowUp = false, onFollowUp, replies = [] }: {
  question: Question & { is_pinned?: boolean; is_spotlighted?: boolean };
  isEchoed: boolean;
  isMine: boolean;
  /** Whether this viewer may spend on an echo — staff always can. */
  canAffordEcho: boolean;
  onEcho: () => void;
  hostView: boolean;
  onStar: () => void;
  onAnswered: () => void;
  onHide: () => void;
  onPin: () => void;
  onSpotlight: () => void;
  onReply: () => void;
  onMute?: () => void;
  onRemove?: () => void;
  editSecondsLeft?: number;
  onEditSave?: (body: string) => Promise<void>;
  canFollowUp?: boolean;
  onFollowUp?: (body: string) => Promise<void>;
  replies?: Question[];
}) {
  const canEcho = !isEchoed && !isMine && canAffordEcho && question.status !== 'hidden';
  const edit = useInlineEdit(question, editSecondsLeft, onEditSave);
  const isSpotlighted = !!question.is_spotlighted;
  const isPinned = !!question.is_pinned;

  return (
    <div className={`card overflow-hidden flex flex-col transition-colors ${
      isSpotlighted              ? 'border-amber-400/60 bg-amber-500/5' :
      isPinned                   ? 'border-brand-orange/50 bg-brand-orange/5' :
      question.status === 'starred'  ? 'border-yellow-500/40 bg-yellow-500/5' :
      question.status === 'answered' ? 'border-emerald-500/30 bg-emerald-500/5' :
      question.status === 'hidden'   ? 'border-brand-border/30 opacity-50' : ''
    }`}>
      {/* Now Answering banner */}
      {isSpotlighted && (
        <div className="bg-amber-500/15 border-b border-amber-400/25 px-4 py-2 flex items-center gap-2">
          <span className="text-amber-300 font-bold text-xs tracking-widest uppercase">🎙 Now Answering</span>
        </div>
      )}

      <div className="p-4 flex gap-3 items-start">
        {/* Body + meta */}
        <div className="flex-1 min-w-0">
          {edit.editing
            ? <InlineEditForm edit={edit} />
            : <p className="text-white text-sm leading-relaxed break-words">{question.body}</p>}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {isPinned && <span className="text-xs text-brand-orange font-semibold">📌 Pinned</span>}
            {isMine && <span className="text-xs text-brand-orange/60 font-medium">Your question</span>}
            {question.edited_at && <span className="text-xs text-purple-200/50 italic">edited</span>}
            <EditAffordance edit={edit} />
            {question.status === 'starred'  && <span className="text-xs text-yellow-400 font-semibold">★ Starred</span>}
            {question.status === 'answered' && <span className="text-xs text-emerald-400 font-semibold">✓ Answered</span>}
            {question.author_username && (
              <span className={`text-xs ${question.post_anonymously ? 'text-purple-300/50 italic' : 'text-purple-200/75'}`}>
                {question.author_username}
              </span>
            )}
          </div>

          {/* Host reply */}
          {question.host_reply && (
            <div className="mt-3 pl-3 border-l-2 border-brand-orange/40">
              <p className="text-xs text-brand-orange/70 font-semibold mb-1">Host reply</p>
              <p className="text-sm text-purple-200/80">{question.host_reply}</p>
            </div>
          )}

          <FollowUpThread replies={replies} canFollowUp={canFollowUp} onFollowUp={onFollowUp} />

          {/* Mod action buttons */}
          {hostView && (
            <div className="mt-3 pt-3 border-t border-brand-border/30 space-y-2">
              {/* Primary actions row */}
              <div className="flex items-center gap-2">
                {/* Spotlight — hero action */}
                <button
                  onClick={onSpotlight}
                  title={isSpotlighted ? 'Clear Now Answering' : 'Mark as Now Answering'}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    isSpotlighted
                      ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                      : 'border-brand-border/60 text-purple-200/90 hover:border-amber-400/40 hover:text-amber-300 hover:bg-amber-500/10'
                  }`}
                >
                  🎙 Now Answering
                </button>

                {/* Star */}
                <button
                  onClick={onStar}
                  title={question.status === 'starred' ? 'Remove star' : 'Star this question'}
                  className={`text-xs font-bold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    question.status === 'starred'
                      ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                      : 'border-brand-border/60 text-purple-200/85 hover:text-yellow-400 hover:border-yellow-500/30'
                  }`}
                >
                  ★ Star
                </button>

                {/* Answered */}
                <button
                  onClick={onAnswered}
                  title={question.status === 'answered' ? 'Mark unanswered' : 'Mark answered'}
                  className={`text-xs font-semibold px-3 py-2.5 rounded-lg border transition-colors min-h-[44px] ${
                    question.status === 'answered'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'border-brand-border/60 text-purple-200/85 hover:text-emerald-400 hover:border-emerald-500/30'
                  }`}
                >
                  {question.status === 'answered' ? '✓ Answered' : '✓ Answered'}
                </button>
              </div>

              {/* Secondary actions row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <ModButton onClick={onPin} title={isPinned ? 'Unpin' : 'Pin to top'} active={isPinned}>
                  {isPinned ? 'Unpin' : 'Pin'}
                </ModButton>
                <ModButton onClick={onHide} title={question.status === 'hidden' ? 'Unhide question' : 'Hide question'} danger={question.status !== 'hidden'} active={question.status === 'hidden'}>
                  {question.status === 'hidden' ? 'Unhide' : 'Hide'}
                </ModButton>
                <ModButton onClick={onReply} title="Add host reply">Reply</ModButton>
                {onMute && (
                  <ModButton onClick={onMute} title={question.author_is_muted ? 'Unmute user' : 'Mute user'} active={!!question.author_is_muted} danger={!question.author_is_muted}>
                    {question.author_is_muted ? 'Unmute User' : 'Mute User'}
                  </ModButton>
                )}
                {onRemove && (
                  <ModButton onClick={() => { if (confirm('Remove this person from the session?')) onRemove!(); }} title="Remove user from session" danger>Remove User</ModButton>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Echo button — right side, matches FeaturedQuestionCard */}
        <div className="shrink-0 flex flex-col items-center min-w-[56px]">
          <button
            onClick={onEcho}
            disabled={!canEcho}
            title={isMine ? "Can't Echo your own question" : isEchoed ? 'Already Echoed' : 'Add Echo'}
            className={`w-full flex flex-col items-center gap-1 px-2 py-3 rounded-xl border transition-all active:scale-95 ${
              isEchoed
                ? 'border-brand-amber/50 bg-brand-amber/10 text-brand-amber'
                : canEcho
                ? 'border-brand-border text-purple-200/90 hover:border-brand-orange/60 hover:bg-brand-orange/10 hover:text-brand-orange'
                : 'border-brand-border/30 text-purple-200/70 cursor-not-allowed'
            }`}
          >
            <span className="text-base font-black leading-none">↑</span>
            <span className="text-xl font-black leading-none">{question.vote_count}</span>
            <span className="text-[10px] font-semibold tracking-wide opacity-60">
              {question.vote_count === 1 ? 'echo' : 'echoes'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A question of your own that the host has not approved yet.
 *
 * Deliberately plain: no echo count, no moderation, no follow-up. None of that
 * means anything until the room can see it. What it does carry is the edit
 * window, which is the reason it is on screen at all — a question submitted for
 * approval was invisible to its own author, so a typo could not be fixed and
 * nothing said it had even been received.
 */
/**
 * A question of your own that the host has not approved yet.
 *
 * Deliberately plain: no echo count, no moderation, no follow-up. None of that
 * means anything until the room can see it. What it does carry is the edit
 * window, which is the reason it is on screen at all — a question submitted for
 * approval was invisible to its own author, so a typo could not be fixed and
 * nothing said it had even been received.
 */
export function PendingQuestionCard({ question, editSecondsLeft, onEditSave }: {
  question: Question;
  editSecondsLeft: number;
  onEditSave: (body: string) => Promise<void>;
}) {
  // A pending question has no deadline — the server drops the window while it
  // waits — so this passes a value that never runs out rather than the real
  // countdown. Showing "Edit · 12s" on something sitting in a queue would be
  // both wrong and a reason not to bother.
  const edit = useInlineEdit(question, Number.MAX_SAFE_INTEGER, onEditSave);
  return (
    <div className="card p-4 border-amber-500/30 bg-amber-500/[0.04]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
          Waiting for approval
        </span>
        <span className="text-xs text-purple-200/70">Only you can see this</span>
      </div>
      {edit.editing
        ? <InlineEditForm edit={edit} />
        : <p className="text-white text-sm leading-relaxed">{question.body}</p>}
      {!edit.editing && (
        <button
          onClick={edit.start}
          className="mt-2 text-xs font-semibold text-brand-orange/80 hover:text-brand-amber transition-colors min-h-[32px]"
        >
          Edit
        </button>
      )}
    </div>
  );
}

export function ModButton({ children, active, danger, onClick, title }: {
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`text-xs px-3 py-2.5 rounded-lg border transition-colors font-semibold min-h-[44px] ${
        active  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' :
        danger  ? 'border-red-700/40 text-red-400 hover:bg-red-900/20' :
                  'border-brand-border/60 text-purple-200/90 hover:border-brand-purple hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
