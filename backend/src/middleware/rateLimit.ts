import rateLimit from 'express-rate-limit';

/** General API limit — 100 req/min per IP */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
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
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down — too many submissions.' },
});
