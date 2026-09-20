'use client';

/**
 * Editing your own question, and the follow-up thread hanging off it.
 *
 * These four move together because they are one mechanism: the hook owns the
 * draft, the form renders it, the affordance opens it, and the thread is where
 * a follow-up is written. Splitting them would mean exporting the draft state
 * across a file boundary, which is the thing that makes this hard to follow in
 * the first place.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { plural } from '@/lib/plural';
import { api } from '@/lib/api';
import type { Question, Session, CallerRole } from '@ask-away/shared/types';
import {
  EchoArrow, SearchIcon, ShareIcon, CopyIcon, CheckIcon, DownloadIcon, FlagIcon,
} from '@/components/session/icons';

/** Seconds an author may still fix their own wording — mirrors EDIT_WINDOW_SECONDS. */
export const EDIT_WINDOW_SECS = 60;

/** Seconds between credit regen ticks — mirrors CREDIT_REGEN_MINUTES on the server. */
// ─── Inline edit (shared by both question cards) ──────────────────────────────

/**
 * The author's correction window. Both cards need identical behaviour and
 * different body styling, so the logic lives here and each card decides where
 * to put the form.
 */
export function useInlineEdit(
  question: Question,
  editSecondsLeft: number,
  onEditSave?: (body: string) => Promise<void>,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(question.body);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // The deadline can pass mid-edit. Close the form rather than leave a Save
  // button that can only fail — the server refuses it either way.
  useEffect(() => {
    if (editing && editSecondsLeft === 0) setEditing(false);
  }, [editing, editSecondsLeft]);

  const save = async () => {
    const next = draft.trim();
    if (!next || next === question.body) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onEditSave!(next);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message ?? 'Could not save that change');
    } finally {
      setSaving(false);
    }
  };

  return {
    editing, saving, error, draft, setDraft, save,
    secondsLeft: editSecondsLeft,
    canEdit: editSecondsLeft > 0 && !!onEditSave,
    start:  () => { setDraft(question.body); setError(null); setEditing(true); },
    cancel: () => { setDraft(question.body); setError(null); setEditing(false); },
  };
}

export type InlineEdit = ReturnType<typeof useInlineEdit>;

export function InlineEditForm({ edit }: { edit: InlineEdit }) {
  return (
    <div>
      <textarea
        value={edit.draft}
        onChange={e => edit.setDraft(e.target.value.slice(0, 300))}
        rows={3}
        autoFocus
        disabled={edit.saving}
        className="w-full bg-brand-bg/60 border border-brand-orange/40 rounded-lg p-2 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-brand-orange disabled:opacity-60"
      />
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button
          onClick={edit.save}
          disabled={edit.saving}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-brand-orange text-white hover:bg-brand-amber transition-colors disabled:opacity-60"
        >
          {edit.saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={edit.cancel}
          disabled={edit.saving}
          className="text-xs font-semibold px-3 py-2 rounded-lg border border-brand-border/60 text-purple-200/90 hover:text-white transition-colors disabled:opacity-60"
        >
          Cancel
        </button>
        <span className="text-xs text-purple-200/70 tabular-nums">{edit.secondsLeft}s left</span>
        <span className="text-xs text-purple-200/50 ml-auto">{edit.draft.length}/300</span>
      </div>
      {edit.error && <p className="text-xs text-red-300 mt-1.5">{edit.error}</p>}
    </div>
  );
}

export function EditAffordance({ edit }: { edit: InlineEdit }) {
  if (!edit.canEdit || edit.editing) return null;
  return (
    <button
      onClick={edit.start}
      className="text-xs font-semibold text-brand-orange/80 hover:text-brand-amber transition-colors"
    >
      Edit · {edit.secondsLeft}s
    </button>
  );
}

// ─── Featured top question card ───────────────────────────────────────────────

/**
 * A question's follow-up thread, and the affordance to add to it.
 *
 * Follow-ups render here rather than loose in the feed so the question and what
 * it provoked are read together — and so an active thread does not scatter
 * itself across the list competing on its own echo count.
 *
 * The button appears only when a follow-up is actually owed: your own question,
 * answered, and not already followed up. It says "free" because that is the
 * whole point — being answered should not depend on having credits left.
 */
// ─── Featured top question card ───────────────────────────────────────────────

/**
 * A question's follow-up thread, and the affordance to add to it.
 *
 * Follow-ups render here rather than loose in the feed so the question and what
 * it provoked are read together — and so an active thread does not scatter
 * itself across the list competing on its own echo count.
 *
 * The button appears only when a follow-up is actually owed: your own question,
 * answered, and not already followed up. It says "free" because that is the
 * whole point — being answered should not depend on having credits left.
 */
export function FollowUpThread({
  replies, canFollowUp, onFollowUp,
}: {
  replies: Question[];
  canFollowUp: boolean;
  onFollowUp?: (body: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  // Collapsed by default. Expanded inline, a long thread pushed every other
  // question down the feed and buried the one people were voting on.
  const [open, setOpen]     = useState(false);

  async function submit() {
    const text = draft.trim();
    if (!text || !onFollowUp) return;
    setBusy(true);
    setError(null);
    try {
      await onFollowUp(text);
      setDraft('');
      setAsking(false);
    } catch (err: any) {
      setError(err?.message ?? 'Could not post that follow-up');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {replies.length > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-white transition-colors"
        >
          <span aria-hidden>&#8629;</span>
          {replies.length === 1 ? '1 follow-up' : `${replies.length} follow-ups`}
          <span className="text-purple-200/60 font-normal">&middot; show</span>
        </button>
      )}

      {replies.length > 0 && open && (
        <div className="mt-3 pl-3 border-l-2 border-violet-400/50 space-y-2.5">
          {replies.map(r => (
            <div key={r.id}>
              <p className="text-[10px] font-semibold text-violet-300 uppercase tracking-wide mb-0.5">
                Follow-up
                {r.status === 'answered' && <span className="ml-1.5 text-emerald-400">\u2713 answered</span>}
              </p>
              <p className="text-sm text-purple-200/90 break-words">{r.body}</p>
            </div>
          ))}
          <button
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-purple-200/70 hover:text-white transition-colors"
          >
            Hide
          </button>
        </div>
      )}

      {canFollowUp && !asking && (
        <button
          onClick={() => setAsking(true)}
          className="mt-3 text-xs font-semibold text-violet-300 hover:text-white transition-colors"
        >
          &#8629; Ask a follow-up &middot; free
        </button>
      )}

      {asking && (
        <div className="mt-3 pl-3 border-l-2 border-brand-purple/40">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 300))}
            rows={2}
            autoFocus
            disabled={busy}
            placeholder="What did that answer leave open?"
            className="w-full bg-brand-bg/60 border border-brand-purple/40 rounded-lg p-2 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-brand-purple disabled:opacity-60"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button
              onClick={submit}
              disabled={busy || !draft.trim()}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-brand-purple text-white hover:bg-brand-purple/80 transition-colors disabled:opacity-40"
            >
              {busy ? 'Posting\u2026' : 'Post follow-up'}
            </button>
            <button
              onClick={() => { setAsking(false); setDraft(''); setError(null); }}
              disabled={busy}
              className="text-xs font-semibold px-3 py-2 rounded-lg border border-brand-border/60 text-purple-200/90 hover:text-white transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
            <span className="text-xs text-purple-200/50 ml-auto">{draft.length}/300</span>
          </div>
          {error && <p className="text-xs text-red-300 mt-1.5">{error}</p>}
        </div>
      )}
    </>
  );
}
