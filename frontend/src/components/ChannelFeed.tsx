'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { isLoggedIn, isGuest } from '@/lib/auth';

/**
 * A channel's feed: the host asks their audience something between shows.
 *
 * The host opens every thread — there is no way to start one from here, which
 * is what keeps this from being an open message board. Replies are free and
 * capped at one each, so the compose box disappears once you have used yours.
 */

interface Prompt {
  id: string;
  body: string;
  closed_at: string | null;
  created_at: string;
  author_username: string;
  reply_count: number;
  has_replied: boolean;
}

interface Reply {
  id: string;
  body: string;
  status: string;
  created_at: string;
  edited_at: string | null;
  author_username: string;
  is_mine: boolean;
  edit_seconds_left: number;
}

export default function ChannelFeed({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ prompts: Prompt[] }>(`/orgs/${orgId}/prompts`)
      .then(d => setPrompts(d.prompts))
      .catch(() => setPrompts([]))
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(load, [load]);

  async function postPrompt() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/orgs/${orgId}/prompts`, { body });
      setDraft('');
      setComposing(false);
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Could not post that');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (!isManager && prompts.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-white">From the host</h2>
          <p className="text-xs text-purple-200/70 mt-0.5">
            Questions for the audience, between shows.
          </p>
        </div>
        {isManager && !composing && (
          <button
            onClick={() => setComposing(true)}
            className="btn-primary text-sm py-2 px-4 flex-shrink-0"
          >
            Ask your followers
          </button>
        )}
      </div>

      {composing && (
        <div className="card p-4 mb-4">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 300))}
            rows={3}
            autoFocus
            disabled={busy}
            placeholder="Who would you like to see as a guest?"
            className="w-full bg-brand-bg/60 border border-brand-border rounded-lg p-3 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-brand-orange disabled:opacity-60"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button
              onClick={postPrompt}
              disabled={busy || !draft.trim()}
              className="btn-primary text-sm py-2 px-4 disabled:opacity-40"
            >
              {busy ? 'Posting…' : 'Post'}
            </button>
            <button
              onClick={() => { setComposing(false); setDraft(''); setError(null); }}
              disabled={busy}
              className="text-sm font-semibold px-3 py-2 rounded-lg border border-brand-border/60 text-purple-200/90 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <span className="text-xs text-purple-200/60 ml-auto">{draft.length}/300</span>
          </div>
          {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        </div>
      )}

      {prompts.length === 0 ? (
        <div className="text-center py-10 text-purple-200/70 border border-dashed border-brand-border/30 rounded-2xl">
          <p className="text-sm">Nothing asked yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prompts.map(p => (
            <PromptCard key={p.id} prompt={p} isManager={isManager} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function PromptCard({ prompt, isManager, onChanged }: {
  prompt: Prompt;
  isManager: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replied, setReplied] = useState(prompt.has_replied);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const closed = !!prompt.closed_at;
  // Guests hold an account-shaped token but cannot reply — the account is the
  // bar. Sending them to register keeps the refusal off the server.
  const canReply = !closed && !replied && isLoggedIn() && !isGuest();

  const loadReplies = useCallback(() => {
    setLoadingReplies(true);
    api.get<{ replies: Reply[] }>(`/prompts/${prompt.id}/replies`)
      .then(d => setReplies(d.replies))
      .catch(() => setReplies([]))
      .finally(() => setLoadingReplies(false));
  }, [prompt.id]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && replies.length === 0) loadReplies();
  }

  async function submit() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/prompts/${prompt.id}/replies`, { body });
      setDraft('');
      setReplied(true);
      setOpen(true);
      loadReplies();
      onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not post that reply');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(reply: Reply) {
    const next = editDraft.trim();
    if (!next || next === reply.body) { setEditingId(null); return; }
    setEditError(null);
    try {
      await api.patch(`/prompts/${prompt.id}/replies/${reply.id}`, { body: next });
      setEditingId(null);
      loadReplies();
    } catch (err: any) {
      setEditError(err?.message ?? 'Could not save that change');
    }
  }

  async function toggleHide(reply: Reply) {
    try {
      await api.patch(`/prompts/${prompt.id}/replies/${reply.id}/hide`, {});
      loadReplies();
      onChanged();
    } catch { /* the list reloads on the next open either way */ }
  }

  async function toggleClosed() {
    try {
      await api.patch(`/prompts/${prompt.id}/close`, {});
      onChanged();
    } catch { /* nothing useful to say here */ }
  }

  return (
    <div className="card p-4">
      <p className="text-white text-sm leading-relaxed break-words">{prompt.body}</p>

      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <span className="text-xs text-purple-200/70">
          {prompt.author_username} · {new Date(prompt.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </span>
        {closed && (
          <span className="text-xs text-purple-200/60 border border-brand-border/60 rounded-full px-2 py-0.5">
            Closed
          </span>
        )}
        <button
          onClick={toggle}
          className="text-xs font-semibold text-violet-300 hover:text-white transition-colors"
        >
          {prompt.reply_count === 1 ? '1 reply' : `${prompt.reply_count} replies`}
          <span className="text-purple-200/60 font-normal ml-1">· {open ? 'hide' : 'show'}</span>
        </button>
        {isManager && (
          <button
            onClick={toggleClosed}
            className="text-xs font-semibold text-purple-200/80 hover:text-white transition-colors ml-auto"
          >
            {closed ? 'Reopen' : 'Close'}
          </button>
        )}
      </div>

      {canReply && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 300))}
            rows={2}
            disabled={busy}
            placeholder="Your answer…"
            className="w-full bg-brand-bg/60 border border-brand-border rounded-lg p-2 text-white text-sm resize-none focus:outline-none focus:border-brand-orange disabled:opacity-60"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={submit}
              disabled={busy || !draft.trim()}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-brand-orange text-white hover:bg-brand-amber transition-colors disabled:opacity-40"
            >
              {busy ? 'Posting…' : 'Reply'}
            </button>
            <span className="text-xs text-purple-200/60 ml-auto">{draft.length}/300 · one reply each</span>
          </div>
          {error && <p className="text-xs text-red-300 mt-1.5">{error}</p>}
        </div>
      )}

      {replied && !closed && (
        <p className="text-xs text-purple-200/60 mt-3">You have replied to this.</p>
      )}

      {!closed && !isLoggedIn() && (
        <p className="text-xs text-purple-200/70 mt-3">
          <Link href="/register" className="text-brand-orange font-semibold hover:text-brand-amber transition-colors">
            Create an account
          </Link>{' '}
          to reply.
        </p>
      )}

      {open && (
        <div className="mt-3 pl-3 border-l-2 border-violet-400/50 space-y-2.5">
          {loadingReplies ? (
            <p className="text-xs text-purple-200/60">Loading…</p>
          ) : replies.length === 0 ? (
            <p className="text-xs text-purple-200/60">No replies yet.</p>
          ) : replies.map(r => (
            <div key={r.id} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-violet-300 uppercase tracking-wide mb-0.5">
                  {r.author_username}
                  {r.status === 'hidden' && (
                    <span className="ml-1.5 text-red-300 normal-case">· hidden</span>
                  )}
                  {r.edited_at && (
                    <span className="ml-1.5 text-purple-200/50 normal-case italic font-normal">edited</span>
                  )}
                </p>
                {editingId === r.id ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value.slice(0, 300))}
                      rows={2}
                      autoFocus
                      className="w-full bg-brand-bg/60 border border-violet-400/50 rounded-lg p-2 text-white text-sm resize-none focus:outline-none focus:border-violet-300"
                    />
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => saveEdit(r)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-orange text-white hover:bg-brand-amber transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditError(null); }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-brand-border/60 text-purple-200/90 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-purple-200/50 ml-auto">{editDraft.length}/300</span>
                    </div>
                    {editError && <p className="text-xs text-red-300 mt-1.5">{editError}</p>}
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-purple-200/90 break-words">{r.body}</p>
                    {r.is_mine && r.edit_seconds_left > 0 && r.status !== 'hidden' && (
                      <button
                        onClick={() => { setEditDraft(r.body); setEditingId(r.id); }}
                        className="mt-1 text-xs font-semibold text-violet-300 hover:text-white transition-colors"
                      >
                        Edit · {Math.ceil(r.edit_seconds_left / 60)}m left
                      </button>
                    )}
                  </>
                )}
              </div>
              {isManager && (
                <button
                  onClick={() => toggleHide(r)}
                  className="text-xs font-semibold text-purple-200/70 hover:text-red-300 transition-colors flex-shrink-0"
                >
                  {r.status === 'hidden' ? 'Restore' : 'Hide'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
