'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface Mod {
  id: string;
  user_id: string;
  username: string;
  can_mark_answered: boolean;
  can_star: boolean;
  can_flag: boolean;
  can_hide: boolean;
  can_mute: boolean;
  can_remove: boolean;
  can_approve: boolean;
  assigned_at: string;
}

interface UserResult {
  id: string;
  username: string;
}

const DEFAULT_PERMS = {
  can_mark_answered: true,
  can_star: true,
  can_flag: true,
  can_hide: false,
  can_mute: true,
  can_remove: false,
  can_approve: false,
};

const PERM_LABELS: { key: keyof typeof DEFAULT_PERMS; label: string }[] = [
  { key: 'can_star',          label: 'Star questions' },
  { key: 'can_mark_answered', label: 'Mark answered' },
  { key: 'can_flag',          label: 'Flag questions' },
  { key: 'can_hide',          label: 'Hide questions' },
  { key: 'can_mute',          label: 'Mute participants' },
  { key: 'can_remove',        label: 'Remove participants' },
  { key: 'can_approve',       label: 'Approve questions' },
];

export default function ModeratorPanel({ sessionId, onClose }: {
  sessionId: string;
  onClose: () => void;
}) {
  const [mods, setMods]         = useState<Mod[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<UserResult[]>([]);
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [perms, setPerms]       = useState({ ...DEFAULT_PERMS });
  const [adding, setAdding]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    loadMods();
  }, [sessionId]);

  async function loadMods() {
    setLoading(true);
    try {
      const rows = await api.get<Mod[]>(`/sessions/${sessionId}/moderators`);
      setMods(rows);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load moderators');
    } finally { setLoading(false); }
  }

  // ── User search ───────────────────────────────────────────────────────────

  function onSearchChange(v: string) {
    setSearch(v);
    setSelected(null);
    clearTimeout(searchTimer.current);
    const query = v.trim().replace(/^@/, '');
    if (query.length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const rows = await api.get<UserResult[]>(`/auth/users/search?q=${encodeURIComponent(query)}`);
        // Filter out already-added mods
        const modIds = new Set(mods.map(m => m.user_id));
        setResults(rows.filter(r => !modIds.has(r.id)));
      } catch {}
    }, 300);
  }

  // ── Add mod ───────────────────────────────────────────────────────────────

  async function addMod() {
    if (!selected) return;
    setAdding(true); setError(null);
    try {
      const mod = await api.post<Mod>(`/sessions/${sessionId}/moderators`, {
        user_id: selected.id,
        ...perms,
      });
      setMods(prev => [...prev, { ...mod, username: selected.username }]);
      setSelected(null); setSearch(''); setResults([]);
      setPerms({ ...DEFAULT_PERMS });
    } catch (err: any) {
      setError(err.message);
    } finally { setAdding(false); }
  }

  // ── Update permissions ────────────────────────────────────────────────────

  async function togglePerm(mod: Mod, perm: keyof typeof DEFAULT_PERMS) {
    const updated = { ...mod, [perm]: !mod[perm] };
    setMods(prev => prev.map(m => m.user_id === mod.user_id ? updated : m));
    try {
      await api.patch(`/sessions/${sessionId}/moderators/${mod.user_id}`, { [perm]: !mod[perm] });
    } catch {
      // Revert on error
      setMods(prev => prev.map(m => m.user_id === mod.user_id ? mod : m));
    }
  }

  // ── Remove mod ────────────────────────────────────────────────────────────

  async function removeMod(userId: string) {
    setMods(prev => prev.filter(m => m.user_id !== userId));
    try {
      await api.delete(`/sessions/${sessionId}/moderators/${userId}`);
    } catch {
      loadMods(); // Re-sync on error
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-sm bg-brand-card border-l border-brand-border flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-border/50">
          <h2 className="font-bold text-white">Moderators</h2>
          <button onClick={onClose} className="text-purple-200/40 hover:text-white transition-colors p-1">
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* ── Add mod ─────────────────────────────────────────────────── */}
          <section>
            <p className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-3">Add moderator</p>

            <div className="relative mb-3">
              <input
                value={search}
                onChange={e => onSearchChange(e.target.value)}
                placeholder="Search by username…"
                className="w-full bg-brand-bg border border-brand-border rounded-xl px-4 py-2.5 text-white text-sm
                           placeholder-brand-border/50 focus:outline-none focus:border-brand-purple transition-colors"
              />

              {results.length > 0 && !selected && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-brand-card border border-brand-border rounded-xl overflow-hidden z-10 shadow-xl">
                  {results.map(u => (
                    <button
                      key={u.id}
                      onClick={() => { setSelected(u); setSearch(`@${u.username}`); setResults([]); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-brand-border/20 transition-colors"
                    >
                      @{u.username}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selected && (
              <div className="space-y-3">
                <div className="bg-brand-bg rounded-xl p-3 flex items-center justify-between">
                  <span className="text-sm text-white font-medium">@{selected.username}</span>
                  <button onClick={() => { setSelected(null); setSearch(''); }} className="text-purple-200/40 hover:text-white text-xs">
                    Clear
                  </button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-purple-200/50 font-semibold">Permissions</p>
                  {PERM_LABELS.map(({ key, label }) => (
                    <PermToggle
                      key={key}
                      label={label}
                      checked={perms[key]}
                      onChange={v => setPerms(p => ({ ...p, [key]: v }))}
                    />
                  ))}
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <button
                  onClick={addMod}
                  disabled={adding}
                  className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
                >
                  {adding ? 'Adding…' : `Add @${selected.username}`}
                </button>
              </div>
            )}
          </section>

          {/* ── Current mods ─────────────────────────────────────────────── */}
          <section>
            <p className="text-xs font-bold text-brand-orange uppercase tracking-widest mb-3">
              Current moderators {mods.length > 0 && `(${mods.length})`}
            </p>

            {loading ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-16 bg-brand-bg rounded-xl animate-pulse" />)}
              </div>
            ) : error && mods.length === 0 ? (
              <p className="text-sm text-red-400 text-center py-6">{error}</p>
            ) : mods.length === 0 ? (
              <p className="text-sm text-purple-200/40 text-center py-6">No moderators yet.</p>
            ) : (
              <div className="space-y-3">
                {mods.map(mod => (
                  <div key={mod.user_id} className="bg-brand-bg rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">@{mod.username}</span>
                      <button
                        onClick={() => removeMod(mod.user_id)}
                        className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-1">
                      {PERM_LABELS.map(({ key, label }) => (
                        <PermToggle
                          key={key}
                          label={label}
                          checked={mod[key]}
                          onChange={() => togglePerm(mod, key)}
                          small
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Permission toggle ────────────────────────────────────────────────────────

function PermToggle({ label, checked, onChange, small }: {
  label: string; checked: boolean;
  onChange: (v: boolean) => void;
  small?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`flex-shrink-0 rounded-full transition-colors relative ${
          small ? 'w-8 h-5' : 'w-10 h-6'
        } ${checked ? 'bg-brand-orange' : 'bg-brand-border'}`}
      >
        <div className={`absolute top-0.5 bg-white rounded-full shadow transition-transform ${
          small
            ? `w-4 h-4 ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`
            : `w-5 h-5 ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`
        }`} />
      </div>
      <span className={`text-purple-200/60 select-none ${small ? 'text-xs' : 'text-sm'}`}>{label}</span>
    </label>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
