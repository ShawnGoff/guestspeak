/**
 * Shared helpers for safely serializing question rows.
 *
 * NEVER send a raw `RETURNING *` question row to clients or broadcast it.
 * Always go through fetchPublicQuestion() or toPublicQuestion() first.
 *
 * - fetchPublicQuestion: full projection with author masking, for question:new
 *   and question:updated events where the client needs the complete object.
 * - toPublicQuestion: lightweight strip for responses where author fields are
 *   not needed (e.g. the HTTP response to the host who just took an action).
 */

import { pool } from '../db/pool';

// ─── Full projection (matches getQuestions SELECT) ───────────────────────────

/**
 * Fetch a single question with the same author-masking projection used in
 * getQuestions. Safe to broadcast or return directly to any client.
 */
export async function fetchPublicQuestion(
  id: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT q.id, q.body, q.status, q.is_pinned, q.is_spotlighted, q.vote_count,
            q.host_reply, q.host_replied_at, q.created_at, q.updated_at,
            q.post_anonymously, q.anon_number,
            CASE
              WHEN q.post_anonymously THEN 'Anon' || q.anon_number
              ELSE COALESCE(q.author_display_name, 'Removed participant')
            END AS author_username,
            CASE WHEN q.post_anonymously THEN NULL ELSE sp.id END AS participant_id,
            CASE WHEN q.post_anonymously THEN NULL ELSE sp.is_muted END AS author_is_muted
     FROM questions q
     LEFT JOIN users u ON u.id = q.author_id AND NOT q.post_anonymously
     LEFT JOIN session_participants sp
       ON sp.session_id = q.session_id
       AND NOT q.post_anonymously
       AND (
         (q.author_guest_token IS NOT NULL AND sp.guest_token = q.author_guest_token)
         OR
         (q.author_id IS NOT NULL AND sp.user_id = q.author_id)
       )
     WHERE q.id = $1 AND q.session_id = $2`,
    [id, sessionId],
  );

  return result.rows[0] ?? null;
}

// ─── Strip-only serializer ───────────────────────────────────────────────────

/**
 * Remove author_id and author_guest_token from a raw RETURNING * row, and
 * synthesize author_username for anon posts. Use when you cannot call
 * fetchPublicQuestion (e.g. the question's session_id is not in scope).
 */
export function toPublicQuestion(row: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { author_id, author_guest_token, author_display_name, ...pub } = row;

  if (pub.post_anonymously) {
    pub.author_username = pub.anon_number != null ? `Anon${pub.anon_number}` : 'Anonymous';
    pub.participant_id = null;
    pub.author_is_muted = null;
  } else {
    // Surface the snapshotted byline under the same key the full projection uses,
    // so callers never see the raw column name or a missing author.
    pub.author_username = (author_display_name as string | null) ?? 'Removed participant';
  }

  return pub;
}
