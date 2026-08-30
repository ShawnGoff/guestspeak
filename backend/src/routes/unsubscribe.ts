/**
 * Turning the go-live email off, from an inbox.
 *
 * Two verbs because two callers:
 *
 *   POST — the mail client. Gmail and Yahoo show their own unsubscribe button
 *          when List-Unsubscribe-Post is present, and pressing it sends this
 *          one request with no human in the loop. It must succeed on its own
 *          and return quickly.
 *   GET  — a person clicking the link in the body. Same effect, then a page
 *          saying what happened.
 *
 * No auth on either, deliberately: an unsubscribe that needs a login is one
 * people skip in favour of the spam button, which is the outcome the header
 * exists to avoid. The token proves the holder was sent mail at that address
 * and authorises nothing else.
 *
 * Not rate limited for the same reason. The worst a flood achieves is setting
 * a flag that is already set, and the signature makes guessing a user id
 * useless. Refusing a real unsubscribe to slow a pointless one is the wrong
 * trade.
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../db/pool';
import { verifyUnsubscribeToken } from '../lib/unsubscribe';

const router = Router();

async function optOut(token: string): Promise<boolean> {
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;

  // Merge rather than replace — this must not clear preferences set elsewhere.
  const result = await pool.query(
    `UPDATE users
        SET notification_prefs = notification_prefs || '{"email_session_live": false}'::jsonb
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — GuestSpeak</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
             background:#1A0A2E;color:#F3F0FF;font-family:Inter,system-ui,sans-serif;padding:1rem;">
  <div style="max-width:26rem;text-align:center;">
    <p style="font-size:1.25rem;font-weight:700;margin:0 0 .5rem;">
      Guest<span style="color:#F5921E;">Speak</span></p>
    <h1 style="font-size:1.25rem;margin:0 0 .75rem;">${title}</h1>
    <p style="color:rgba(221,214,254,.75);line-height:1.6;margin:0;">${body}</p>
  </div>
</body></html>`;
}

/** One-click, from the mail client. Body carries the token; query works too. */
router.post('/', async (req: Request, res: Response) => {
  const token = String(req.body?.token ?? req.query.token ?? '');
  await optOut(token);
  // Always 200. Telling a mail client the unsubscribe failed earns a spam
  // complaint, and a bad token means the link was mangled, not that the person
  // still wants the mail.
  res.status(200).send('OK');
});

router.get('/', async (req: Request, res: Response) => {
  const ok = await optOut(String(req.query.token ?? ''));
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  res.status(200).type('html').send(
    ok
      ? page(
        'Unsubscribed',
        'You will no longer be emailed when a channel you follow goes live.<br><br>'
        + 'You still get these in the app, and you are still following the channel. '
        + `<a href="${appUrl}/settings" style="color:#F5921E;">Change this in settings</a>.`,
      )
      : page(
        'That link did not work',
        'It may have been broken by your mail client. You can turn these emails off in '
        + `<a href="${appUrl}/settings" style="color:#F5921E;">your settings</a>, `
        + 'or unfollow the channel.',
      ),
  );
});

export default router;
