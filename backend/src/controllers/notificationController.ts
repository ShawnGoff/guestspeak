import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { z } from 'zod';
import { sendToUsers, publicKey, type PushPayload } from '../lib/push';

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

  // Push rides along here rather than at each call site: this is the one place
  // notifications are created, so both events are covered by one hook and any
  // future notification type gets push for free.
  //
  // Deliberately not awaited. The in-app row above is the source of truth and is
  // already committed; push is an enhancement and must never delay or fail the
  // request that triggered it.
  const push = pushCopy(type, payload);
  if (push) {
    sendToUsers(userIds, push).catch(err =>
      console.error('[notifications] push delivery failed:', err),
    );
  }
}

/**
 * Notification copy for the lock screen.
 *
 * Returns null for types that should not interrupt someone's phone. Silence is
 * the default: a notification type has to earn a push.
 */
function pushCopy(type: string, p: Record<string, unknown>): PushPayload | null {
  const sessionTitle = String(p.session_title ?? 'a session');
  const slug = p.session_slug ? `/s/${p.session_slug}` : '/';

  switch (type) {
    case 'session:live':
      return {
        title: p.org_name ? `${p.org_name} is live` : 'A session is live',
        body: `${sessionTitle} has started. Ask your question now.`,
        url: slug,
        // One notification per session, so a channel going live repeatedly does
        // not stack up on the lock screen.
        tag: `session-live-${p.session_id ?? slug}`,
      };

    case 'question:replied':
      return {
        title: 'The host replied',
        body: `Your question in ${sessionTitle} got an answer.`,
        url: slug,
        tag: `reply-${p.question_id ?? slug}`,
      };

    case 'channel:prompt':
      return {
        title: p.org_name ? `${p.org_name} asked a question` : 'A channel asked a question',
        body: String(p.prompt_body ?? 'Tap to answer.'),
        url: p.org_slug ? `/org/${p.org_slug}` : '/',
        // One per prompt. A host who posts twice should not have the second
        // quietly replace the first, so the id is in the tag rather than the
        // channel — unlike session:live, where repeated go-lives of the same
        // session genuinely are the same event.
        tag: `channel-prompt-${p.prompt_id ?? p.org_slug ?? ''}`,
      };

    default:
      return null;
  }
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

// ─── Push subscriptions ───────────────────────────────────────────────────────

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth:   z.string().min(1).max(255),
  }),
});

/**
 * GET /api/notifications/push/key
 * The VAPID public key the browser needs to subscribe. Public by design.
 * Returns null when push is not configured, so the client can hide the UI
 * rather than offering a toggle that cannot work.
 */
export function getPushKey(_req: Request, res: Response) {
  res.json({ key: publicKey() });
}

/**
 * POST /api/notifications/push
 * Register this browser for push. Idempotent on endpoint: re-subscribing on the
 * same browser updates the keys in place instead of accumulating dead rows.
 */
export async function subscribePush(req: Request, res: Response, next: NextFunction) {
  try {
    const sub = SubscriptionSchema.parse(req.body);
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh  = EXCLUDED.p256dh,
             auth    = EXCLUDED.auth,
             failure_count = 0`,
      [req.user!.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );
    res.status(201).json({ subscribed: true });
  } catch (err) { next(err); }
}

/**
 * DELETE /api/notifications/push
 * Unregister this browser. Scoped to the caller so one user cannot remove
 * another's subscription by guessing an endpoint.
 */
export async function unsubscribePush(req: Request, res: Response, next: NextFunction) {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body);
    await pool.query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
      [endpoint, req.user!.userId],
    );
    res.json({ unsubscribed: true });
  } catch (err) { next(err); }
}
