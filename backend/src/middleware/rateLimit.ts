import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';

const JWT_SECRET = process.env.JWT_SECRET ?? '';

/**
 * Rate-limit bucket key: the authenticated caller when there is one, otherwise
 * the client IP.
 *
 * Conference venues put every attendee behind a single NAT address, so a purely
 * IP-keyed limit throttles a whole room as if it were one abusive client. The
 * token signature is verified (HMAC, no DB round-trip) so a caller cannot forge
 * a token to escape their own bucket.
 */
export function callerKey(req: Request): string {
  const payload = verifiedPayload(req);
  if (payload) {
    // Guests are keyed on their guest token, which is capped separately by
    // guestLimiter and by the per-session IP cap in joinSession.
    const subject = payload.guestToken ?? payload.userId;
    if (subject) return `sub:${subject}`;
  }

  return `ip:${normalizeIp(req.ip)}`;
}

/**
 * The caller's verified token payload, or null when there isn't a valid one.
 * HMAC only — no DB round-trip, so this is safe to call on the hot path.
 */
function verifiedPayload(req: Request): { userId?: string; guestToken?: string } | null {
  const header = req.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!raw || !JWT_SECRET) return null;

  try {
    return jwt.verify(raw, JWT_SECRET) as { userId?: string; guestToken?: string };
  } catch {
    return null; // invalid/expired tokens fall back to IP keying
  }
}

/**
 * Collapse IPv6 addresses to their /64 prefix. A single client is typically
 * handed a whole /64, so keying on the full address lets one host rotate
 * through effectively unlimited buckets.
 */
function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!bare.includes(':')) return bare; // IPv4
  return bare.split(':').slice(0, 4).join(':') + '::/64';
}

/**
 * General API limit — 600 req/min per caller.
 *
 * Keyed per caller rather than per IP: a live session has every attendee
 * polling questions, echoing, and sending credit heartbeats, and a whole
 * venue shares one egress IP.
 */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  keyGenerator: callerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

/**
 * Login — tight, brute-force target.
 * 10 attempts per 15 min per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

/**
 * Register + password reset — moderate.
 * 10 per 15 min per IP.
 */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

/**
 * Guest token issuance — permissive to handle conference NAT (many attendees,
 * one IP). 120 per 15 min per IP ≈ one new guest every 7.5 seconds.
 */
export const guestLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many guest requests. Try again in 15 minutes.' },
});

/**
 * Username availability check — called on every keystroke in the UI.
 * Very permissive; usernames are semi-public anyway.
 */
export const checkUsernameLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

/**
 * Kept for any existing import sites — maps to loginLimiter.
 * @deprecated use the specific limiters below instead.
 */
export const authLimiter = loginLimiter;

/**
 * Question submission — prevent credit farming via rapid posts.
 *
 * Two tiers, decided from the token alone so this stays a HMAC check with no
 * DB round-trip:
 *
 *   guests and anonymous callers → 10/min. A guest identity is free to mint,
 *     so the limiter is doing real work here.
 *   registered accounts          → 60/min.
 *
 * The higher tier is not a hole. An ordinary registered participant is already
 * bound far below it by the credit economy — they hold at most a handful of
 * credits and regain one per CREDIT_REGEN_MINUTES — so the limiter was never
 * what stopped them. The only callers who can actually reach 60 are the ones
 * exempt from credits: hosts, org owners/admins, and moderators. Leaving them
 * on 10 meant a host seeding a prepared queue — the podcast case, questions
 * lined up well before the show — stopped at ten with a message accusing them
 * of spamming their own session.
 *
 * It stays a limit rather than an exemption because this route is optionalAuth
 * and a stolen host token should not be able to flood a room faster than a
 * human can respond.
 */
const QUESTION_LIMIT_ACCOUNT = 60;
const QUESTION_LIMIT_ANON    = 10;

export const questionLimiter = rateLimit({
  windowMs: 60_000,
  limit: (req: Request) => {
    const payload = verifiedPayload(req);
    const isAccount = Boolean(payload?.userId) && !payload?.guestToken;
    return isAccount ? QUESTION_LIMIT_ACCOUNT : QUESTION_LIMIT_ANON;
  },
  keyGenerator: callerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many submissions.' },
});

/**
 * Channel-feed replies.
 *
 * The session burst cooldown lives on session_participants and has nothing to
 * key off here — a channel reply has no participant row. This is the stand-in,
 * and it matters more than the session one because replies are free: there is
 * no credit economy slowing anybody down.
 */
export const channelReplyLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyGenerator: callerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many replies.' },
});

/**
 * Flagging — a moderation signal, so cheap mass-flagging must not be possible.
 * 20 per 5 min per caller.
 */
export const flagLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 20,
  keyGenerator: callerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports. Try again shortly.' },
});
