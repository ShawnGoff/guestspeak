/**
 * Web push delivery.
 *
 * Push is strictly an enhancement: the in-app notification row is the source of
 * truth and is written first. Nothing here may ever fail a request — a host
 * replying to a question must not see an error because someone's phone has an
 * expired subscription.
 *
 * Configured by VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT. With none
 * set, every function here is a no-op, so local development and tests run
 * without push configured.
 */

import webpush from 'web-push';
import { pool } from '../db/pool';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';
// Push services require a contact so they can reach you about a misbehaving
// sender. mailto: or https: only.
const SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:support@guestspeak.app';

export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn(
    '[push] VAPID keys not set — web push is disabled. ' +
    'In-app notifications and email are unaffected.',
  );
}

/** The public key the browser needs at subscribe time. Safe to expose. */
export function publicKey(): string | null {
  return pushEnabled ? PUBLIC_KEY : null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path the notification opens. Relative to the site root. */
  url?: string;
  /** Collapse key — a later notification with the same tag replaces the earlier. */
  tag?: string;
}

/**
 * Deliver to every subscription belonging to these users.
 *
 * Fire-and-forget by design: callers should not await this on a request path.
 * Failures are logged, and subscriptions the push service reports as gone are
 * deleted rather than retried.
 */
export async function sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushEnabled || userIds.length === 0) return;

  const { rows } = await pool.query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])`,
    [userIds],
  );
  if (rows.length === 0) return;

  const body = JSON.stringify(payload);
  const gone: string[] = [];

  await Promise.allSettled(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
      );
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      const code = (err as { code?: string })?.code;

      // 404/410 mean the browser dropped the subscription — uninstalled,
      // permission revoked, or storage cleared.
      const dropped = status === 404 || status === 410;

      // A subscription whose keys will not encrypt is equally dead, and is not
      // reported as an HTTP status because it fails before the request is made.
      // Without this it would be retried on every future notification forever,
      // logging an error each time and never being cleaned up.
      const unusable = typeof code === 'string' && code.startsWith('ERR_CRYPTO');

      if (dropped || unusable) {
        gone.push(row.id);
        if (unusable) {
          console.warn(`[push] dropping subscription with unusable keys (${code})`);
        }
      } else {
        console.error(`[push] delivery failed (${status ?? code ?? 'unknown'}):`, err);
      }
    }
  }));

  if (gone.length > 0) {
    await pool.query('DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[])', [gone])
      .catch(err => console.error('[push] could not prune dead subscriptions:', err));
  }

  const delivered = rows.length - gone.length;
  if (delivered > 0) {
    await pool.query(
      `UPDATE push_subscriptions SET last_used_at = NOW()
       WHERE user_id = ANY($1::uuid[]) AND id <> ALL($2::uuid[])`,
      [userIds, gone],
    ).catch(() => {});
  }
}
