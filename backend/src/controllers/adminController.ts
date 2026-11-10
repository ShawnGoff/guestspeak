import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { invalidateWordCache } from '../lib/wordFilter';

// ─── Flags ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/flags
 * Flagged questions across all sessions, newest first.
 * Optional filters: ?sessionId= &reason= &limit= &offset=
 */
export async function listFlags(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.query.sessionId as string | undefined;
    const reason    = req.query.reason    as string | undefined;
    const limit  = Math.min(parseInt(req.query.limit  as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (sessionId) { params.push(sessionId); conditions.push(`q.session_id = $${params.length}`); }
    if (reason)    { params.push(reason);    conditions.push(`f.reason = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await pool.query(
      `SELECT
         f.id AS flag_id, f.reason, f.is_moderator_flag, f.created_at AS flagged_at,
         COUNT(f.id) OVER (PARTITION BY f.question_id)::int AS flag_count,
         q.id AS question_id, q.body, q.status, q.session_id,
         s.title AS session_title, s.slug AS session_slug,
         -- Anonymous posts stay anonymous here. Naming the author in this list
         -- bypassed revealIdentity, which is the one path that writes to the
         -- audit log.
         CASE WHEN q.post_anonymously THEN 'Anon' || q.anon_number
              ELSE COALESCE(q.author_display_name, u.username, sp.guest_username, 'Removed participant')
         END AS author_username,
         CASE WHEN q.post_anonymously THEN NULL ELSE sp.id END AS participant_id
       FROM flags f
       JOIN questions q ON q.id = f.question_id
       JOIN sessions  s ON s.id = q.session_id
       LEFT JOIN users u ON u.id = q.author_id
       LEFT JOIN session_participants sp
         ON sp.session_id = q.session_id
         AND (
           (q.author_guest_token IS NOT NULL AND sp.guest_token = q.author_guest_token)
           OR (q.author_id IS NOT NULL AND sp.user_id = q.author_id)
         )
       ${where}
       ORDER BY f.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ data: result.rows, limit, offset });
  } catch (err) { next(err); }
}

// ─── Platform bans ────────────────────────────────────────────────────────────

// duration_hours: 24 = 1 day, 72 = 3 days, 168 = 1 week, null/omitted = permanent.
// Mutually exclusive with expires_at — prefer duration_hours in the admin UI.
const CreateBanSchema = z.object({
  user_id:        z.string().uuid().optional(),
  guest_token:    z.string().optional(),
  ip_address:     z.string().optional(),
  // Ban whoever wrote this question. The preferred path for a guest: the admin
  // never handles the token, so revealing an identity no longer also hands over
  // the ability to act as them.
  question_id:    z.string().uuid().optional(),
  reason:         z.string().min(1).max(500),
  duration_hours: z.union([z.literal(24), z.literal(72), z.literal(168)]).optional(),
  // Escape hatch — raw ISO datetime (admin can still pass a custom date).
  // If both duration_hours and expires_at are provided, duration_hours wins.
  expires_at:     z.string().datetime().optional(),
}).refine(d => d.user_id || d.guest_token || d.ip_address || d.question_id, {
  message: 'At least one of user_id, guest_token, ip_address, or question_id is required',
});

/** GET /api/admin/bans — list active platform bans */
export async function listBans(req: Request, res: Response, next: NextFunction) {
  try {
    const includeExpired = req.query.includeExpired === 'true';
    const limit  = Math.min(parseInt(req.query.limit  as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const activeFilter = includeExpired ? '' : `AND (pb.expires_at IS NULL OR pb.expires_at > NOW())`;

    const result = await pool.query(
      `SELECT pb.*, u.username AS banned_username, a.username AS banned_by_username
       FROM platform_bans pb
       LEFT JOIN users u ON u.id = pb.user_id
       LEFT JOIN users a ON a.id = pb.banned_by
       WHERE true ${activeFilter}
       ORDER BY pb.banned_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    res.json({ data: result.rows, limit, offset });
  } catch (err) { next(err); }
}

/** POST /api/admin/bans — issue a platform ban */
export async function createBan(req: Request, res: Response, next: NextFunction) {
  try {
    const data = CreateBanSchema.parse(req.body);
    const adminId = req.user!.userId;

    // Resolve a question into whoever wrote it, so the admin can ban a guest
    // without ever being handed their token.
    let userId = data.user_id ?? null;
    let guestToken = data.guest_token ?? null;
    if (data.question_id) {
      const author = await pool.query(
        'SELECT author_id, author_guest_token FROM questions WHERE id = $1',
        [data.question_id],
      );
      if (!author.rows[0]) throw new AppError(404, 'Question not found');
      userId = userId ?? author.rows[0].author_id;
      guestToken = guestToken ?? author.rows[0].author_guest_token;
      if (!userId && !guestToken && !data.ip_address) {
        throw new AppError(409, 'That question has no author left to ban');
      }
    }

    // Resolve expires_at: duration_hours takes precedence over raw expires_at.
    // null = permanent.
    let expiresAt: string | null = null;
    if (data.duration_hours != null) {
      const exp = new Date();
      exp.setHours(exp.getHours() + data.duration_hours);
      expiresAt = exp.toISOString();
    } else if (data.expires_at) {
      expiresAt = data.expires_at;
    }

    // Log the action
    await pool.query(
      `INSERT INTO admin_action_log (admin_id, action, target_type, target_id, notes)
       VALUES ($1, 'platform_ban', 'user', $2, $3)`,
      // The resolved target, not the raw input — a question_id ban would
      // otherwise log nothing identifying.
      [adminId, userId ?? guestToken ?? data.ip_address, data.reason],
    );

    const result = await pool.query(
      `INSERT INTO platform_bans (user_id, guest_token, ip_address, reason, expires_at, banned_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, guestToken, data.ip_address ?? null,
       data.reason, expiresAt, adminId],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
}

/** DELETE /api/admin/bans/:id — lift a platform ban */
export async function liftBan(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM platform_bans WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!result.rows[0]) throw new AppError(404, 'Ban not found');

    await pool.query(
      `INSERT INTO admin_action_log (admin_id, action, target_type, target_id)
       VALUES ($1, 'ban_lifted', 'platform_ban', $2)`,
      [req.user!.userId, id],
    );

    res.json({ lifted: true });
  } catch (err) { next(err); }
}

// ─── Banned words ─────────────────────────────────────────────────────────────

/** GET /api/admin/banned-words */
export async function listBannedWords(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT bw.id, bw.word, bw.added_at, u.username AS added_by_username
       FROM banned_words bw
       LEFT JOIN users u ON u.id = bw.added_by
       ORDER BY bw.word`,
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

/** POST /api/admin/banned-words */
export async function addBannedWord(req: Request, res: Response, next: NextFunction) {
  try {
    const { word } = z.object({ word: z.string().min(1).max(100) }).parse(req.body);
    const clean = word.trim().toLowerCase();
    const adminId = req.user!.userId;

    const result = await pool.query(
      `INSERT INTO banned_words (word, added_by) VALUES ($1, $2)
       ON CONFLICT (word) DO NOTHING
       RETURNING *`,
      [clean, adminId],
    );

    await pool.query(
      `INSERT INTO admin_action_log (admin_id, action, target_type, target_id)
       VALUES ($1, 'word_added', 'banned_word', $2)`,
      [adminId, clean],
    );

    invalidateWordCache();
    res.status(201).json(result.rows[0] ?? { word: clean, note: 'already exists' });
  } catch (err) { next(err); }
}

/** DELETE /api/admin/banned-words/:id */
export async function removeBannedWord(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM banned_words WHERE id = $1 RETURNING word`,
      [id],
    );
    if (!result.rows[0]) throw new AppError(404, 'Word not found');

    await pool.query(
      `INSERT INTO admin_action_log (admin_id, action, target_type, target_id)
       VALUES ($1, 'word_removed', 'banned_word', $2)`,
      [req.user!.userId, result.rows[0].word],
    );

    invalidateWordCache();
    res.json({ removed: true });
  } catch (err) { next(err); }
}

// ─── Identity reveal ──────────────────────────────────────────────────────────

/**
 * GET /api/admin/questions/:id/identity
 * Returns the real author identity behind any post (including anon).
 * Every call is logged — this is intentionally a heavy paper trail.
 */
export async function revealIdentity(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;

    const result = await pool.query(
      `SELECT q.id, q.body, q.author_id,
              q.author_display_name,
              u.username, u.email,
              sp.guest_username,
              -- Deliberately not the guest token. It is a bearer credential:
              -- whoever holds it can post as that guest and spend their
              -- credits, so returning it made "reveal who wrote this" also
              -- grant "act as them". Ban by question_id instead — the server
              -- resolves the author without the token leaving the database.
              (q.author_guest_token IS NOT NULL) AS is_guest
       FROM questions q
       LEFT JOIN users u ON u.id = q.author_id
       LEFT JOIN session_participants sp
         ON sp.session_id = q.session_id
         AND (
           (q.author_guest_token IS NOT NULL AND sp.guest_token = q.author_guest_token)
           OR (q.author_id IS NOT NULL AND sp.user_id = q.author_id)
         )
       WHERE q.id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new AppError(404, 'Question not found');

    // Always log — immutable audit trail
    await pool.query(
      `INSERT INTO admin_action_log (admin_id, action, target_type, target_id)
       VALUES ($1, 'identity_reveal', 'question', $2)`,
      [adminId, id],
    );

    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// ─── Admin self-check ─────────────────────────────────────────────────────────

/** GET /api/admin/me — confirms caller is an admin (used by frontend to gate the panel) */
// ─── Featured sessions ────────────────────────────────────────────────────────

/**
 * GET /api/admin/sessions — recent sessions for the admin feature-toggle panel
 */
export async function listSessionsAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const q = ((req.query.q as string) ?? '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const params: unknown[] = [];
    let where = '';
    if (q) { params.push(`%${q}%`); where = `WHERE s.title ILIKE $${params.length}`; }
    params.push(limit);
    const result = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.is_featured, s.created_at,
              u.username AS host_username
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

/**
 * PATCH /api/admin/sessions/:id/feature — toggle is_featured on a session
 */
export async function featureSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { featured } = z.object({ featured: z.boolean() }).parse(req.body);
    const result = await pool.query(
      `UPDATE sessions SET is_featured = $1 WHERE id = $2 RETURNING id, title, is_featured`,
      [featured, id],
    );
    if (!result.rows[0]) throw new AppError(404, 'Session not found');
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

// ─── Admin identity ───────────────────────────────────────────────────────────

export async function adminMe(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, username, email, is_platform_admin FROM users WHERE id = $1`,
      [req.user!.userId],
    );
    if (!result.rows[0]?.is_platform_admin) {
      throw new AppError(403, 'Platform admin access required');
    }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}
