import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

// ─── Public helper (used by sessionController) ────────────────────────────────

/**
 * Insert notifications for a batch of users in one statement.
 * Fire-and-forget friendly — does nothing if userIds is empty.
 */
export async function createNotificationsForUsers(
  userIds: string[],
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!userIds.length) return;
  await pool.query(
    `INSERT INTO notifications (user_id, type, payload)
     SELECT unnest($1::uuid[]), $2, $3`,
    [userIds, type, JSON.stringify(payload)],
  );
}

// ─── API handlers ─────────────────────────────────────────────────────────────

/**
 * GET /api/notifications
 * Returns the caller's 30 most recent notifications + total unread count.
 */
export async function listNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const limit  = Math.min(parseInt(req.query.limit  as string ?? '30'), 50);
    const offset = Math.max(parseInt(req.query.offset as string ?? '0'),  0);
    const userId = req.user!.userId;

    const [rows, unread] = await Promise.all([
      pool.query(
        `SELECT id, type, payload, read_at, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId],
      ),
    ]);

    res.json({
      notifications: rows.rows,
      unread_count:  unread.rows[0].count,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notifications/read
 * Marks ALL unread notifications for the caller as read.
 */
export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE user_id = $1 AND read_at IS NULL`,
      [req.user!.userId],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notifications/:id/read
 * Marks one notification as read.
 */
export async function markOneRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `UPDATE notifications SET read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, req.user!.userId],
    );
    if (!result.rows[0]) throw new AppError(404, 'Notification not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/notifications/:id
 * Delete a single notification.
 */
export async function deleteNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user!.userId],
    );
    if (!result.rows[0]) throw new AppError(404, 'Notification not found');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}
