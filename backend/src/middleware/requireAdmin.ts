import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { requireRegistered } from './auth';

/**
 * Middleware that verifies the caller is a registered user AND a platform admin.
 * Chain after requireAuth — do not use standalone.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireRegistered(req, res, async () => {
    try {
      const result = await pool.query<{ is_platform_admin: boolean }>(
        'SELECT is_platform_admin FROM users WHERE id = $1',
        [req.user!.userId],
      );
      if (!result.rows[0]?.is_platform_admin) {
        res.status(403).json({ error: 'Platform admin access required' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  });
}
