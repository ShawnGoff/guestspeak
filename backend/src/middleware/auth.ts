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

const JWT_SECRET = process.env.JWT_SECRET!;

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
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // For registered users with a versioned token, verify the version hasn't been rotated
    if (!payload.isGuest && payload.v !== undefined) {
      const result = await pool.query(
        'SELECT token_version FROM users WHERE id = $1',
        [payload.userId],
      );
      const row = result.rows[0];
      if (!row || row.token_version !== payload.v) {
        res.status(401).json({ error: 'Session expired. Please sign in again.' });
        return;
      }
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Attaches user to req if a valid token is present, but does not block guests.
 * Useful for routes accessible to both authenticated users and guests.
 */
/**
 * Like requireAuth, but also blocks guest accounts.
 * Use on routes that require a real registered user (e.g. create session, create org).
 */
export function requireRegistered(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (req.user?.isGuest) {
      res.status(403).json({ error: 'You must have an account to do this' });
      return;
    }
    next();
  });
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req, false);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      // ignore — guest continues unauthenticated
    }
  }
  next();
}

/**
 * Like optionalAuth but also accepts ?token= in the query string.
 * Only use this on the SSE endpoint — EventSource cannot set headers,
 * so the query string is the only way to pass a token there.
 * Do NOT use on regular REST routes: query-string tokens leak into logs
 * and browser history.
 */
export function optionalAuthSSE(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req, true);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      // ignore — guest continues unauthenticated
    }
  }
  next();
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
