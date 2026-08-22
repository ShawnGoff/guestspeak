import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

// ─── Search users ─────────────────────────────────────────────────────────────

export async function searchUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = ((req.query.q as string) ?? '').trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         (SELECT COUNT(*) FROM sessions WHERE host_id = u.id AND visibility = 'public')::int AS session_count
       FROM users u
       WHERE u.is_guest = false
         AND u.username ILIKE $1
       ORDER BY session_count DESC, u.username
       LIMIT 20`,
      [`%${q}%`],
    );

    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
}

// ─── Get user profile ─────────────────────────────────────────────────────────

export async function getUserProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const userResult = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.created_at,
         (SELECT COUNT(*) FROM sessions WHERE host_id = u.id AND visibility = 'public')::int AS session_count
       FROM users u
       WHERE u.username = $1 AND u.is_guest = false`,
      [username],
    );

    if (userResult.rows.length === 0) throw new AppError(404, 'User not found');

    const profile = userResult.rows[0];

    // Public sessions
    const sessionsResult = await pool.query(
      `SELECT id, title, slug, status, starts_at, created_at,
              (SELECT COUNT(*) FROM session_participants WHERE session_id = sessions.id)::int AS participant_count,
              (SELECT COUNT(*) FROM questions WHERE session_id = sessions.id)::int AS question_count
       FROM sessions
       WHERE host_id = $1 AND visibility = 'public'
       ORDER BY created_at DESC
       LIMIT 10`,
      [profile.id],
    );

    res.json({ profile, sessions: sessionsResult.rows });
  } catch (err) {
    next(err);
  }
}

// ─── Follow a user ────────────────────────────────────────────────────────────

