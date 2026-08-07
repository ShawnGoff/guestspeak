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
  const header = req.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (raw && JWT_SECRET) {
    try {
      const payload = jwt.verify(raw, JWT_SECRET) as { userId?: string; guestToken?: string };
      // Guests are keyed on their guest token, which is capped separately by
      // guestLimiter and by the per-session IP cap in joinSession.
      const subject = payload.guestToken ?? payload.userId;
      if (subject) return `sub:${subject}`;
    } catch {
      // Fall through to IP for invalid/expired tokens.
    }
  }

  return `ip:${normalizeIp(req.ip)}`;
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

/** Question submission — prevent credit farming via rapid posts */
export const questionLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: callerKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many submissions.' },
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
