/**
 * Unsubscribe links.
 *
 * An unsubscribe link has to work from an inbox: no session, no login, years
 * after it was sent. That rules out anything with an expiry and anything that
 * needs the recipient to be signed in — a person who wants the mail to stop
 * will not sign in to say so, they will press the spam button, and that is the
 * outcome the header exists to prevent.
 *
 * So: an HMAC over the user id, verified by recomputation. Nothing is stored,
 * nothing expires, and the link cannot be guessed from a user id.
 *
 * It is deliberately NOT a JWT. A JWT here would be a bearer credential sitting
 * in every inbox and forwarded mailbox, and the auth middleware would accept
 * it. This proves one thing — that the holder was sent mail at this address —
 * and grants exactly one power: turning that mail off. The key is derived from
 * JWT_SECRET rather than being it, so a token cannot be replayed against
 * anything that verifies sessions.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const PURPOSE = 'guestspeak:unsubscribe:v1';

function key(): Buffer {
  const secret = process.env.JWT_SECRET ?? '';
  if (!secret) throw new Error('JWT_SECRET is required to sign unsubscribe links');
  // Derived, not reused — see above.
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

const b64url = (b: Buffer) => b.toString('base64url');

function sign(userId: string): string {
  return b64url(createHmac('sha256', key()).update(userId).digest());
}

/** The opaque token that goes in the link. */
export function unsubscribeToken(userId: string): string {
  return `${b64url(Buffer.from(userId, 'utf8'))}.${sign(userId)}`;
}

/** The user id a token vouches for, or null if it does not verify. */
export function verifyUnsubscribeToken(token: string): string | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 2) return null;

  let userId: string;
  try {
    userId = Buffer.from(parts[0], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;

  const expected = Buffer.from(sign(userId), 'utf8');
  const given = Buffer.from(parts[1], 'utf8');
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and the length is not a secret.
  if (expected.length !== given.length) return null;
  return timingSafeEqual(expected, given) ? userId : null;
}

/** The link that goes in the mail. */
export function unsubscribeUrl(userId: string): string {
  // `||` not `??`: a variable cleared in a hosting dashboard is an empty
  // string, not undefined, and `??` would keep it. An empty base turns every
  // unsubscribe link into a relative path — which no mail client can resolve,
  // which nothing logs, and which is only discoverable by reading a delivered
  // email. Blank means absent here, the same call as sentry.client.config.ts.
  const base = (process.env.API_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3001')
    .replace(/\/$/, '');
  return `${base}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(userId))}`;
}
