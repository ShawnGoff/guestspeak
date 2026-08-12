import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

export interface JwtPayload {
  userId: string;
  isGuest: boolean;
  guestToken?: string;
  /** token_version at sign time — used to invalidate tokens on password change */
  v?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Verifies a token and confirms its token_version still matches the user's.
 * Returns the payload, or null if the token is invalid/expired/revoked.
 *
 * Revocation matters on every route, not just the ones behind requireAuth:
 * a password change bumps token_version, and a stolen token must stop working
 * on the participant-facing routes (ask, echo, flag, join, stream) too.
 */
async function verifyToken(token: string): Promise<JwtPayload | null> {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }

  // Guests have no password and no token_version to rotate.
  if (payload.isGuest || payload.v === undefined) return payload;

  const result = await pool.query(
    'SELECT token_version, deleted_at FROM users WHERE id = $1',
    [payload.userId],
  );
  const row = result.rows[0];
  if (!row || row.token_version !== payload.v) return null;
  // A deleted account must not authenticate even if a token somehow survives.
  if (row.deleted_at) return null;

  return payload;
}

/**
 * Verifies a JWT from the Authorization header.
 * Attaches decoded payload to req.user.
 * Returns 401 if missing or invalid.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req, false);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = await verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }

    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Like requireAuth, but also blocks guest accounts.
 * Use on routes that require a real registered user (e.g. create session, create org).
 */
export function requireRegistered(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.user?.isGuest) {
      res.status(403).json({ error: 'You must have an account to do this' });
      return;
    }
    next();
  });
}

/**
 * Attaches user to req if a valid, non-revoked token is present, but does not
 * block guests. Useful for routes accessible to both authenticated users and
 * guests. A revoked token is treated as no token at all — the caller falls back
 * to being anonymous rather than acting as the user.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  await attachOptionalUser(req, next, false);
}

/**
 * Like optionalAuth but also accepts ?token= in the query string.
 * Only use this on the SSE endpoint — EventSource cannot set headers,
 * so the query string is the only way to pass a token there.
 * Do NOT use on regular REST routes: query-string tokens leak into logs
 * and browser history.
 */
export async function optionalAuthSSE(req: Request, res: Response, next: NextFunction) {
  await attachOptionalUser(req, next, true);
}

async function attachOptionalUser(req: Request, next: NextFunction, allowQuery: boolean) {
  const token = extractToken(req, allowQuery);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = await verifyToken(token);
    if (payload) req.user = payload;
    next();
  } catch (err) {
    // A DB failure during revocation check must not silently downgrade the
    // caller to anonymous — surface it instead.
    next(err);
  }
}

function extractToken(req: Request, allowQuery: boolean): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (allowQuery) {
    const query = req.query.token;
    if (typeof query === 'string' && query) return query;
  }
  return null;
}

export function signToken(payload: JwtPayload): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as any,
  });
}
