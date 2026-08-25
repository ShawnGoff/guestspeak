import Link from 'next/link';
import { plural } from '@/lib/plural';

/**
 * One session in a host's own list — dashboard and /sessions/mine.
 *
 * This was written out twice, once per page, and the two copies drifted. The
 * mobile tap-target pass fixed the title link in one of them and left the
 * other at 24px; only re-measuring in the browser caught it. Four smaller
 * differences had accumulated the same way and are resolved below, each
 * keeping whichever copy was doing the better thing.
 *
 * Not to be confused with the "Recently Attended" card on the dashboard. That
 * one looks similar but is a different thing: the viewer attended rather than
 * hosted, so it has no join code and no delete, and it credits the host
 * instead of the channel. It stays where it is.
 */

export interface MySession {
  id: string;
  title: string;
  slug: string;
  status: 'upcoming' | 'live' | 'closed';
  visibility: 'public' | 'unlisted' | 'private';
  join_code: string;
  starts_at: string | null;
  created_at: string;
  participant_count: number;
  question_count: number;
  org_name: string | null;
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StatusBadge({ status }: { status: MySession['status'] }) {
  if (status === 'live') {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Live
      </span>
    );
  }
  if (status === 'upcoming') {
    return (
      <span className="px-2 py-0.5 rounded-full bg-brand-orange/20 text-brand-orange text-xs font-semibold">
        Upcoming
      </span>
    );
  }
  // "Ended", not "Archived". /sessions/mine said the latter and everywhere
  // else — the session page itself, the dashboard, the profile page — said
  // the former, so one closed session was badged two different ways depending
  // on which list you happened to be looking at.
  return (
    <span className="px-2 py-0.5 rounded-full bg-brand-border/30 text-purple-200/70 text-xs font-semibold">
      Ended
    </span>
  );
}

export function VisibilityPill({ visibility }: { visibility: MySession['visibility'] }) {
  if (visibility === 'public') return null;
  return (
    <span className="px-2 py-0.5 rounded-full border border-brand-border/50 text-purple-200/60 text-xs">
      {visibility}
    </span>
  );
}

export default function SessionCard({ session: s, onCopy, copiedCode, onDelete, isDeleting }: {
  session: MySession;
  onCopy: (code: string) => void;
  copiedCode: string | null;
  /** Omitted by the dashboard, which lists only live and upcoming sessions. */
  onDelete?: (id: string, title: string) => void;
  isDeleting?: boolean;
}) {
  const copied = copiedCode === s.join_code;

  return (
    <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
      {/* Left: title + meta */}
      <div className="flex-1 min-w-0">
        {/* flex-wrap: a long channel name alongside both pills overran the
            row on a phone. Only /sessions/mine had it. */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <StatusBadge status={s.status} />
          {s.org_name && (
            <span className="text-xs text-purple-200/70">{s.org_name}</span>
          )}
          <VisibilityPill visibility={s.visibility} />
        </div>
        <Link
          href={`/s/${s.slug}`}
          className="block py-2.5 -my-1 font-bold text-white hover:text-brand-amber transition-colors line-clamp-1"
        >
          {s.title}
        </Link>
        <div className="flex items-center gap-4 mt-1 text-xs text-purple-200/70">
          <span>{s.participant_count} joined</span>
          <span>{plural(s.question_count, 'question')}</span>
          {s.starts_at && s.status !== 'live' && (
            <span>{formatDate(s.starts_at)}</span>
          )}
          {/* Created is the fallback when there is no start time, not a second
              date alongside it. The dashboard copy showed both. */}
          {s.status === 'closed' && !s.starts_at && (
            <span>Created {formatDate(s.created_at)}</span>
          )}
        </div>
      </div>

      {/* Right: join code + actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {s.status !== 'closed' && (
          <button
            onClick={() => onCopy(s.join_code)}
            title="Copy join code"
            className={`flex items-center gap-1.5 font-mono text-sm px-3 py-1.5 min-h-[44px] rounded-lg border transition-colors ${
              copied
                ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                : 'border-brand-border text-white hover:border-brand-purple'
            }`}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {s.join_code}
          </button>
        )}
        <Link href={`/s/${s.slug}`} className="btn-ghost text-sm py-1.5 px-3">
          {s.status === 'live' ? 'Manage' : s.status === 'closed' ? 'View' : 'Preview'}
        </Link>
        {s.status === 'closed' && onDelete && (
          <button
            onClick={() => onDelete(s.id, s.title)}
            disabled={isDeleting}
            title="Delete session"
            className="text-purple-200/60 hover:text-red-400 transition-colors disabled:opacity-40 w-11 h-11 flex items-center justify-center"
          >
            {isDeleting ? <span className="text-xs">…</span> : <TrashIcon />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
