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
      `SELECT p.id, p.closed_at,
              EXISTS (
                SELECT 1 FROM channel_feed_blocks b
                 WHERE b.org_id = p.org_id AND b.user_id = $2
              ) AS blocked
         FROM channel_prompts p WHERE p.id = $1`,
      [promptId, callerId],
    );
    if (!promptResult.rows[0]) throw new AppError(404, 'Prompt not found');
    if (promptResult.rows[0].closed_at) {
      throw new AppError(410, 'This prompt is no longer taking replies');
    }
    // Deliberately indistinguishable from any other refusal. Telling someone
    // they have been blocked invites them back with a second account.
    if (promptResult.rows[0].blocked) {
      throw new AppError(403, 'You cannot reply to this channel');
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

/**
 * PATCH /api/prompts/:promptId/replies/:replyId/hide
 *
 * Toggles a reply out of the public list. Channel staff only.
 *
 * Records who and when. `status` alone says a reply is hidden; it does not say
 * who decided that, which is exactly what an author asking why they were
 * removed needs answering from.
 */
export async function hideReply(req: Request, res: Response, next: NextFunction) {
  try {
    const { promptId, replyId } = req.params;
    const callerId = req.user!.userId;

    const owner = await pool.query(
      `SELECT p.org_id FROM channel_replies r
         JOIN channel_prompts p ON p.id = r.prompt_id
        WHERE r.id = $1 AND r.prompt_id = $2`,
      [replyId, promptId],
    );
    if (!owner.rows[0]) throw new AppError(404, 'Reply not found');
    await requireChannelStaff(owner.rows[0].org_id, callerId);

    const result = await pool.query(
      `UPDATE channel_replies
          SET status    = CASE WHEN status = 'hidden' THEN 'new' ELSE 'hidden' END,
              -- Cast explicitly. With NULL in the other arm Postgres cannot
              -- infer the parameter's type and rejects it as text — the same
              -- inference trap that broke question status changes.
              hidden_by = CASE WHEN status = 'hidden' THEN NULL ELSE $2::uuid END,
              hidden_at = CASE WHEN status = 'hidden' THEN NULL ELSE NOW() END
        WHERE id = $1
        RETURNING id, prompt_id, body, status, created_at`,
      [replyId, callerId],
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/orgs/:id/feed-blocks — stop someone replying to this channel.
 *
 * One reply per prompt already bounds a single thread, so hiding handles a bad
 * reply. This is for the person who keeps coming back to the next prompt.
 *
 * Scoped to the channel's feed, not the platform: a host deciding they are done
 * with someone should not be deciding it for anybody else's channel.
 */
export async function blockFromFeed(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orgId } = req.params;
    const callerId = req.user!.userId;
    const { user_id, reason } = z.object({
      user_id: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }).parse(req.body);

    await requireChannelStaff(orgId, callerId);

    // Staff blocking staff would be a way to lock a co-owner out of their own
    // channel's feed, so it is refused rather than merely discouraged.
    const target = await pool.query(
      'SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2',
      [orgId, user_id],
    );
    if (target.rows[0]) throw new AppError(403, 'You cannot block someone who runs this channel');

    await pool.query(
      `INSERT INTO channel_feed_blocks (org_id, user_id, blocked_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [orgId, user_id, callerId, reason ?? null],
    );

    res.status(201).json({ blocked: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/orgs/:id/feed-blocks/:userId */
export async function unblockFromFeed(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orgId, userId } = req.params;
    await requireChannelStaff(orgId, req.user!.userId);

    await pool.query(
      'DELETE FROM channel_feed_blocks WHERE org_id = $1 AND user_id = $2',
      [orgId, userId],
    );

    res.json({ blocked: false });
  } catch (err) {
    next(err);
  }
}

/** GET /api/orgs/:id/feed-blocks — staff only. */
export async function listFeedBlocks(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: orgId } = req.params;
    await requireChannelStaff(orgId, req.user!.userId);

    const result = await pool.query(
      `SELECT b.user_id, b.reason, b.created_at, u.username
         FROM channel_feed_blocks b
         JOIN users u ON u.id = b.user_id
        WHERE b.org_id = $1
        ORDER BY b.created_at DESC`,
      [orgId],
    );

    res.json({ blocks: result.rows });
  } catch (err) {
    next(err);
  }
}
