import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import { pool } from '../db/pool';
import { signToken } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { sendPasswordReset } from '../lib/mailer';
import { rejectIfBanned } from '../lib/wordFilter';

/** Single source of truth — changing a password must not weaken its hash. */
const BCRYPT_ROUNDS = 12;

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8),
  // Optional: guest_token to migrate participant/question records to the new account
  guest_token: z.string().optional(),
});

const UpdateMeSchema = z.object({
  code_prefix: z.string().min(2).max(8).regex(/^[A-Z0-9]+$/).optional().nullable(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
}).refine(d => {
  // If changing password, both fields required
  if (d.new_password && !d.current_password) return false;
  if (d.current_password && !d.new_password) return false;
  return true;
}, { message: 'Both current_password and new_password are required to change password' });

const LoginSchema = z.object({
  email: z.string().min(1), // accepts email or username
  password: z.string(),
});

export async function register(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { email, username, password, guest_token } = RegisterSchema.parse(req.body);
    await rejectIfBanned(username);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO users (email, username, password_hash, is_guest)
       VALUES ($1, $2, $3, false)
       RETURNING id, email, username, is_guest, created_at, token_version`,
      [email, username, passwordHash],
    );

    const user = result.rows[0];

    // If registering from a guest session, migrate participant and question records
    if (guest_token) {
      await client.query(
        `UPDATE session_participants
         SET user_id = $1, guest_token = NULL
         WHERE guest_token = $2`,
        [user.id, guest_token],
      );
      await client.query(
        `UPDATE questions
         SET author_id = $1
         WHERE author_guest_token = $2 AND author_id IS NULL`,
        [user.id, guest_token],
      );
    }

    await client.query('COMMIT');

    const token = signToken({ userId: user.id, isGuest: false, v: user.token_version });
    const { token_version: _tv, ...safeUser } = user;

    res.status(201).json({ token, user: safeUser });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') {
      next(new AppError(409, 'Email or username already taken'));
    } else {
      next(err);
    }
  } finally {
    client.release();
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = LoginSchema.parse(req.body);

    const result = await pool.query(
      `SELECT id, email, username, is_guest, password_hash, token_version FROM users
       WHERE (email = $1 OR LOWER(username) = LOWER($1))
         AND is_guest = false AND deleted_at IS NULL`,
      [email],
    );

    const user = result.rows[0];
    if (!user) throw new AppError(401, 'Invalid credentials');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new AppError(401, 'Invalid credentials');

    const token = signToken({ userId: user.id, isGuest: false, v: user.token_version });
    const { password_hash: _, token_version: _tv, ...safeUser } = user;

    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
}

/** GET /api/users/search?q= — find registered users by username (for mod assignment) */
export async function searchUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req.query.q as string ?? '').trim();
    if (q.length < 2) { res.json([]); return; }
    const result = await pool.query(
      `SELECT id, username FROM users
       WHERE is_guest = false AND username ILIKE $1
       ORDER BY username LIMIT 10`,
      [`${q}%`],
    );
    res.json(result.rows);
  } catch (err) { next(err); }
}

/** GET /api/auth/me — return the current user's profile */
export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT id, email, username, code_prefix, created_at FROM users WHERE id = $1`,
      [req.user!.userId],
    );
    if (!result.rows[0]) throw new AppError(404, 'User not found');
    res.json(result.rows[0]);
  } catch (err) { next(err); }
}

/** PATCH /api/auth/me — update profile (code_prefix and/or password) */
export async function updateMe(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const data = UpdateMeSchema.parse(req.body);
    const userId = req.user!.userId;

    await client.query('BEGIN');

    // Password change
    if (data.current_password && data.new_password) {
      const userResult = await client.query(
        `SELECT password_hash FROM users WHERE id = $1`,
        [userId],
      );
      const valid = await bcrypt.compare(data.current_password, userResult.rows[0]?.password_hash ?? '');
      if (!valid) throw new AppError(400, 'Current password is incorrect');

      const newHash = await bcrypt.hash(data.new_password, BCRYPT_ROUNDS);
      await client.query(
        `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
        [newHash, userId],
      );
    }

    // Code prefix update
    if (data.code_prefix !== undefined) {
      const prefix = data.code_prefix ? data.code_prefix.toUpperCase() : null;
      await client.query(`UPDATE users SET code_prefix = $1 WHERE id = $2`, [prefix, userId]);
    }

    await client.query('COMMIT');

    const result = await client.query(
      `SELECT id, email, username, code_prefix, created_at FROM users WHERE id = $1`,
      [userId],
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code === '23505') next(new AppError(409, 'That join code prefix is already taken'));
    else next(err);
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/auth/me — delete the caller's account.
 *
 * Required by App Store Review Guideline 5.1.1(v) and by GDPR erasure requests.
 *
 * Implemented as anonymisation, not DELETE. See migration 028 for the full
 * reasoning: a real DELETE fails on sessions.host_id (RESTRICT), and cascading
 * instead would destroy questions written by other people. Keeping the row and
 * stripping every personal field erases the person while leaving the room's
 * content — and other users' moderation history — intact.
 *
 * Requires the current password. A deletion this irreversible should not be
 * reachable with a stolen token alone.
 */
export async function deleteAccount(req: Request, res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
    const userId = req.user!.userId;

    const userResult = await client.query(
      `SELECT password_hash, deleted_at FROM users WHERE id = $1`,
      [userId],
    );
    const user = userResult.rows[0];
    if (!user || user.deleted_at) throw new AppError(404, 'Account not found');

    const valid = await bcrypt.compare(password, user.password_hash ?? '');
    if (!valid) throw new AppError(400, 'Password is incorrect');

    // Organisations they solely own need resolving first. Deleting an org that
    // other people belong to as a side effect of one member leaving would be a
    // surprise; deleting a solo org they are the only member of is not. So the
    // solo case is handled silently and the shared case is refused with
    // instructions, which is what GitHub does and what avoids trapping anyone.
    const soleOwned = await client.query(
      `SELECT o.id, o.name,
              (SELECT COUNT(*) FROM organization_members m2
                WHERE m2.org_id = o.id AND m2.user_id <> $1)::int AS other_members
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id AND om.user_id = $1
       WHERE om.role = 'owner'
         AND NOT EXISTS (
           SELECT 1 FROM organization_members m3
           WHERE m3.org_id = o.id AND m3.user_id <> $1 AND m3.role = 'owner'
         )`,
      [userId],
    );

    const shared = soleOwned.rows.filter(r => r.other_members > 0);
    if (shared.length > 0) {
      const names = shared.map(r => r.name).join(', ');
      throw new AppError(
        409,
        `You are the only owner of ${names}. Transfer ownership or delete ` +
        `${shared.length === 1 ? 'it' : 'them'} before deleting your account.`,
      );
    }

    await client.query('BEGIN');

    // Solo organisations go with them. Sessions survive: organizations.id is
    // ON DELETE SET NULL from sessions.org_id, so the Q&A stays, unaffiliated.
    for (const org of soleOwned.rows) {
      await client.query('DELETE FROM organizations WHERE id = $1', [org.id]);
    }

    // The byline snapshot added in migration 027 stores the username on every
    // question at post time. Nulling users.username alone would leave the name
    // on public display, so the snapshot has to be scrubbed too.
    await client.query(
      `UPDATE questions SET author_display_name = NULL WHERE author_id = $1`,
      [userId],
    );

    // Guest display names recorded against their participation.
    await client.query(
      `UPDATE session_participants SET guest_username = NULL WHERE user_id = $1`,
      [userId],
    );

    // Relationships and anything addressed to them personally. These would
    // cascade on a real DELETE; since the row survives, remove them explicitly.
    await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    // Would cascade on a real DELETE; since the row survives anonymisation, a
    // deleted account would otherwise keep receiving push on their devices.
    await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query(
      'DELETE FROM user_follows WHERE follower_id = $1 OR following_id = $1', [userId]);
    await client.query('DELETE FROM org_followers WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM organization_members WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM session_moderators WHERE user_id = $1', [userId]);

    // Strip the person. Every one of these columns is nullable, and PostgreSQL
    // allows repeated NULLs under a UNIQUE index, so the username and email are
    // released for reuse and deleted accounts never collide with each other.
    // Bumping token_version invalidates every issued token immediately.
    await client.query(
      `UPDATE users
       SET email             = NULL,
           username          = NULL,
           password_hash     = NULL,
           code_prefix       = NULL,
           ip_address        = NULL,
           is_platform_admin = false,
           token_version     = token_version + 1,
           deleted_at        = NOW(),
           updated_at        = NOW()
       WHERE id = $1`,
      [userId],
    );

    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
}

/**
 * POST /api/auth/forgot-password
 * Accepts an email, creates a reset token, sends an email.
 * Always returns 200 to avoid leaking whether an email exists.
 */
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const userResult = await pool.query(
      `SELECT id, email FROM users WHERE email = $1 AND is_guest = false`,
      [email],
    );

    // Always respond 200 — don't reveal whether the email is registered
    if (!userResult.rows[0]) {
      res.json({ message: 'If that email is registered you will receive a reset link.' });
      return;
    }

    const user = userResult.rows[0];

    // Invalidate any existing unused tokens for this user
    await pool.query(
      `DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );

    // Generate a secure random token, store its hash
    const rawToken = randomUUID();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash) VALUES ($1, $2)`,
      [user.id, tokenHash],
    );

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    await sendPasswordReset(user.email, resetUrl);

    res.json({ message: 'If that email is registered you will receive a reset link.' });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 * Validates the token and sets a new password.
 */
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = z.object({
      token: z.string().uuid(),
      password: z.string().min(8),
    }).parse(req.body);

    const tokenHash = createHash('sha256').update(token).digest('hex');

    const tokenResult = await pool.query(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    const row = tokenResult.rows[0];
    if (!row) throw new AppError(400, 'Invalid or expired reset link.');
    if (row.used_at) throw new AppError(400, 'This reset link has already been used.');
    if (new Date(row.expires_at) < new Date()) throw new AppError(400, 'This reset link has expired.');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await pool.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
      [passwordHash, row.user_id],
    );
    await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);

    res.json({ message: 'Password updated. You can now sign in.' });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/check-username?username=xxx
 * Returns { available: boolean } — checks if a name is free for a guest to use.
 * Only blocked by registered (non-guest) users, not other guests.
 */
export async function checkUsername(req: Request, res: Response, next: NextFunction) {
  try {
    const username = (req.query.username as string ?? '').trim();
    if (!username) throw new AppError(400, 'username is required');

    const result = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND is_guest = false`,
      [username],
    );

    res.json({ available: result.rowCount === 0 });
  } catch (err) {
    next(err);
  }
}

/**
 * Issues a short-lived guest token that lets anonymous users ask questions
 * and add Echoes within credit limits.
 */
export async function guestToken(req: Request, res: Response, next: NextFunction) {
  try {
    const guestToken = `guest_${randomUUID()}`;
    const ipAddress = req.ip ?? null;

    // Create a guest user row so foreign keys resolve.
    // Record IP so platform IP-bans can be checked on every action.
    const result = await pool.query(
      `INSERT INTO users (is_guest, ip_address) VALUES (true, $1) RETURNING id`,
      [ipAddress],
    );
    const userId = result.rows[0].id;

    const token = signToken({ userId, isGuest: true, guestToken });
    res.json({ token, guestToken });
  } catch (err) {
    next(err);
  }
}
