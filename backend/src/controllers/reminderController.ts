/**
 * Per-session reminders.
 *
 * Following a channel is a standing subscription to everything it puts on.
 * That is the wrong unit for someone who found one session on Discover — a
 * conference talk, a panel, a guest on a station they do not otherwise follow.
 * A reminder says "this one", and is answered once, when it starts.
 *
 * Registered accounts only. notifications.user_id is NOT NULL against users, so
 * a guest has nowhere to receive one; the button prompts a signed-out visitor
 * to sign up, matching what follow already does.
 */

import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

/** POST /api/sessions/:id/reminder */
export async function setReminder(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    // Read the status too: reminding someone about a session that already
    // started is a notification that will never arrive, and the button should
    // not have been there. Better a clear 400 than a silent dead row.
    const session = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM sessions WHERE id = $1`,
      [id],
    );
    if (!session.rows[0]) throw new AppError(404, 'Session not found');
    if (session.rows[0].status !== 'upcoming') {
      throw new AppError(400, 'That session is not upcoming');
    }

    // ON CONFLICT rather than a check-then-insert: two taps on a slow
    // connection race, and the unique constraint is the arbiter.
    await pool.query(
      `INSERT INTO session_reminders (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id, user_id) DO NOTHING`,
      [id, req.user!.userId],
    );

    res.json({ reminded: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/sessions/:id/reminder */
export async function clearReminder(req: Request, res: Response, next: NextFunction) {
  try {
    // No existence check and no 404 on a missing row. The caller wants to end
    // up not reminded, and they are.
    await pool.query(
      `DELETE FROM session_reminders WHERE session_id = $1 AND user_id = $2`,
      [req.params.id, req.user!.userId],
    );
    res.json({ reminded: false });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/sessions/reminders — the caller's outstanding reminders, as ids.
 *
 * One request for the whole page rather than a flag per card: Discover renders
 * up to twenty upcoming sessions, and a join against reminders in each of the
 * four nearby query variants is four places to get the anonymous case wrong.
 * The set is small and belongs to the viewer, so the client holds it.
 */
export async function listMyReminders(req: Request, res: Response, next: NextFunction) {
  try {
    const { rows } = await pool.query<{ session_id: string }>(
      `SELECT r.session_id
         FROM session_reminders r
         JOIN sessions s ON s.id = r.session_id
        WHERE r.user_id = $1
          AND s.status = 'upcoming'`,
      [req.user!.userId],
    );
    res.json({ sessionIds: rows.map(r => r.session_id) });
  } catch (err) {
    next(err);
  }
}
