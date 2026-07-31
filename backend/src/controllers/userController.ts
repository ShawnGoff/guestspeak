import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

// ─── Search users ─────────────────────────────────────────────────────────────

export async function searchUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const q = ((req.query.q as string) ?? '').trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }

    const callerId = req.user?.userId ?? null;

    const isFollowingExpr = callerId
      ? `EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $2 AND following_id = u.id)`
      : `false`;

    const params: any[] = [`%${q}%`];
    if (callerId) params.push(callerId);

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id)::int AS follower_count,
         (SELECT COUNT(*) FROM sessions WHERE host_id = u.id AND visibility = 'public')::int AS session_count,
         ${isFollowingExpr} AS is_following
       FROM users u
       WHERE u.is_guest = false
         AND u.username ILIKE $1
       ORDER BY follower_count DESC, u.username
       LIMIT 20`,
      params,
    );

    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
}

// ─── Get user profile ─────────────────────────────────────────────────────────

export async function getUserProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const callerId = req.user?.userId ?? null;

    const isFollowingExpr = callerId
      ? `EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $2 AND following_id = u.id)`
      : `false`;
    const profileParams: any[] = [username];
    if (callerId) profileParams.push(callerId);

    const userResult = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.created_at,
         (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id)::int AS follower_count,
         (SELECT COUNT(*) FROM user_follows WHERE follower_id = u.id)::int AS following_count,
         (SELECT COUNT(*) FROM sessions WHERE host_id = u.id AND visibility = 'public')::int AS session_count,
         ${isFollowingExpr} AS is_following
       FROM users u
       WHERE u.username = $1 AND u.is_guest = false`,
      profileParams,
    );

    if (userResult.rows.length === 0) throw new AppError(404, 'User not found');

    const profile = userResult.rows[0];

    // Public sessions
    const sessionsResult = await pool.query(
      `SELECT id, title, slug, status, starts_at, created_at,
              (SELECT COUNT(*) FROM session_participants WHERE session_id = sessions.id)::int AS participant_count,
              (SELECT COUNT(*) FROM questions WHERE session_id = sessions.id)::int AS question_count
       FROM sessions
       WHERE host_id = $1 AND visibility = 'public'
       ORDER BY created_at DESC
       LIMIT 10`,
      [profile.id],
    );

    res.json({ profile, sessions: sessionsResult.rows });
  } catch (err) {
    next(err);
  }
}

// ─── Follow a user ────────────────────────────────────────────────────────────

export async function followUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const followerId = req.user!.userId;

    const target = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND is_guest = false`,
      [username],
    );
    if (target.rows.length === 0) throw new AppError(404, 'User not found');

    const followingId = target.rows[0].id;
    if (followingId === followerId) throw new AppError(400, 'You cannot follow yourself');

    await pool.query(
      `INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [followerId, followingId],
    );

    res.json({ following: true });
  } catch (err) {
    next(err);
  }
}

// ─── Unfollow a user ──────────────────────────────────────────────────────────

export async function unfollowUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const followerId = req.user!.userId;

    const target = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND is_guest = false`,
      [username],
    );
    if (target.rows.length === 0) throw new AppError(404, 'User not found');

    const followingId = target.rows[0].id;

    await pool.query(
      `DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
      [followerId, followingId],
    );

    res.json({ following: false });
  } catch (err) {
    next(err);
  }
}

// ─── Followers list ───────────────────────────────────────────────────────────

export async function getFollowers(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const callerId = req.user?.userId ?? null;

    const target = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND is_guest = false`,
      [username],
    );
    if (target.rows.length === 0) throw new AppError(404, 'User not found');

    const followersExpr = callerId
      ? `EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $2 AND following_id = u.id)`
      : `false`;
    const followersParams: any[] = [target.rows[0].id];
    if (callerId) followersParams.push(callerId);

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id)::int AS follower_count,
         ${followersExpr} AS is_following
       FROM user_follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      followersParams,
    );

    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
}

// ─── Following list ───────────────────────────────────────────────────────────

export async function getFollowing(req: Request, res: Response, next: NextFunction) {
  try {
    const { username } = req.params;
    const callerId = req.user?.userId ?? null;

    const target = await pool.query(
      `SELECT id FROM users WHERE username = $1 AND is_guest = false`,
      [username],
    );
    if (target.rows.length === 0) throw new AppError(404, 'User not found');

    const followingExpr = callerId
      ? `EXISTS(SELECT 1 FROM user_follows WHERE follower_id = $2 AND following_id = u.id)`
      : `false`;
    const followingParams: any[] = [target.rows[0].id];
    if (callerId) followingParams.push(callerId);

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         (SELECT COUNT(*) FROM user_follows WHERE following_id = u.id)::int AS follower_count,
         ${followingExpr} AS is_following
       FROM user_follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      followingParams,
    );

    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
}
