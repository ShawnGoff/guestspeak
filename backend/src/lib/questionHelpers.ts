/**
 * Shared helper for safely serializing question rows.
 *
 * NEVER send a raw `RETURNING *` question row to clients or broadcast it —
 * always go through fetchPublicQuestion(). Besides stripping author_id and
 * author_guest_token, it is the only path that resolves the byline correctly:
 * a bare question row carries no join data, so it cannot fall back to a live
 * lookup when author_display_name is null.
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
            q.host_reply, q.host_replied_at, q.created_at, q.updated_at, q.edited_at,
q.parent_question_id, q.thread_root_id,
            q.post_anonymously, q.anon_number,
            CASE
              WHEN q.post_anonymously THEN 'Anon' || q.anon_number
              ELSE COALESCE(q.author_display_name, u.username, sp.guest_username, 'Removed participant')
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
