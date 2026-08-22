import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { filterText } from '../lib/wordFilter';

/**
 * Channel feeds: a host asks their audience something between shows.
 *
 * The host opens every thread. Followers reply to a prompt and cannot start
 * one — that is the line between this and the open message board that was
 * ruled out. Sessions are for live events; this is the gap between them.
 *
 * Replies are free. There is no session, so there is no credit balance to draw
 * on, and the whole point is to reward people who are already here. That also
 * removes the economic brake the rest of the product relies on, which is why
 * the account requirement, the rate limit, the word filter and the one-reply
 * rule all matter more here than they would elsewhere.
 */

const PromptSchema = z.object({ body: z.string().min(1).max(300) });
const ReplySchema  = z.object({ body: z.string().min(1).max(300) });

/** Throws unless the caller runs this channel. */
async function requireChannelStaff(orgId: string, callerId: string) {
  const result = await pool.query(
    'SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, callerId],
  );
  const role = result.rows[0]?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new AppError(403, 'Only a channel owner or admin can do this');
  }
}

/** True when the caller runs the channel this prompt belongs to. */
async function isStaffForPrompt(promptId: string, callerId: string | null): Promise<boolean> {
  if (!callerId) return false;
  const result = await pool.query(
    `SELECT 1 FROM channel_prompts p
       JOIN organization_members om ON om.org_id = p.org_id AND om.user_id = $2
      WHERE p.id = $1 AND om.role IN ('owner', 'admin')`,
    [promptId, callerId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** POST /api/orgs/:id/prompts */
export async function createPrompt(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orgId } = req.params;
    const callerId = req.user!.userId;
    const { body } = PromptSchema.parse(req.body);

    await requireChannelStaff(orgId, callerId);

    const result = await pool.query(
      `INSERT INTO channel_prompts (org_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, org_id, body, closed_at, created_at`,
      [orgId, callerId, await filterText(body)],
    );

    res.status(201).json({ ...result.rows[0], reply_count: 0, has_replied: false });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/orgs/:id/prompts
 *
 * Public: the channel page anyone can open shows the feed. `has_replied` is
 * per-caller so the client knows whether to offer the reply box, and it is the
 * reason this is not cached the way the session feed is.
 */
export async function listPrompts(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orgId } = req.params;
    const callerId = req.user?.isGuest === false ? req.user.userId : null;

    const result = await pool.query(
      `SELECT p.id, p.org_id, p.body, p.closed_at, p.created_at,
              u.username AS author_username,
              (SELECT COUNT(*)::int FROM channel_replies r
                WHERE r.prompt_id = p.id AND r.status <> 'hidden') AS reply_count,
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM channel_replies r
                 WHERE r.prompt_id = p.id AND r.author_id = $2
              )) AS has_replied
         FROM channel_prompts p
         JOIN users u ON u.id = p.author_id
        WHERE p.org_id = $1
        ORDER BY p.created_at DESC
        LIMIT 50`,
      [orgId, callerId],
    );

    res.json({ prompts: result.rows });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/prompts/:promptId/close — stop taking replies. */
export async function closePrompt(req: Request, res: Response, next: NextFunction) {
  try {
    const { promptId } = req.params;
    const callerId = req.user!.userId;

    const owner = await pool.query('SELECT org_id FROM channel_prompts WHERE id = $1', [promptId]);
    if (!owner.rows[0]) throw new AppError(404, 'Prompt not found');
    await requireChannelStaff(owner.rows[0].org_id, callerId);

    const result = await pool.query(
      `UPDATE channel_prompts
          SET closed_at = CASE WHEN closed_at IS NULL THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, org_id, body, closed_at, created_at`,
      [promptId],
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/prompts/:promptId/replies
 *
 * Registered accounts only — not "must be following". Following is one click
 * and reversible, so it is thin as a control; the account is the real bar, and
 * guests cannot hold one.
 */
export async function createReply(req: Request, res: Response, next: NextFunction) {
  try {
    const { promptId } = req.params;
    const { body } = ReplySchema.parse(req.body);
    const callerId = req.user!.userId;

    const promptResult = await pool.query(
      'SELECT id, closed_at FROM channel_prompts WHERE id = $1',
      [promptId],
    );
    if (!promptResult.rows[0]) throw new AppError(404, 'Prompt not found');
    if (promptResult.rows[0].closed_at) {
      throw new AppError(410, 'This prompt is no longer taking replies');
    }

    const who = await pool.query('SELECT username FROM users WHERE id = $1', [callerId]);

    try {
      const result = await pool.query(
        `INSERT INTO channel_replies (prompt_id, author_id, author_display_name, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, prompt_id, body, status, created_at, author_display_name`,
        [promptId, callerId, who.rows[0]?.username ?? null, await filterText(body)],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      // The unique index is the enforcement, not a prior SELECT — two taps can
      // race through a check-then-insert.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError(409, 'You have already replied to this');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/prompts/:promptId/replies */
export async function listReplies(req: Request, res: Response, next: NextFunction) {
  try {
    const { promptId } = req.params;
    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    const isStaff = await isStaffForPrompt(promptId, callerId);

    const result = await pool.query(
      `SELECT r.id, r.prompt_id, r.body, r.status, r.created_at,
              COALESCE(r.author_display_name, u.username, 'Removed account') AS author_username
         FROM channel_replies r
         LEFT JOIN users u ON u.id = r.author_id
        WHERE r.prompt_id = $1
          AND ($2 OR r.status <> 'hidden')
        ORDER BY r.created_at
        LIMIT 200`,
      [promptId, isStaff],
    );

    res.json({ replies: result.rows });
  } catch (err) {
    next(err);
  }
}
