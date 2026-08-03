import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { requireHostOrOrgAdmin, resolveCallerRole } from '../db/permissions';
import { broadcastTo } from '../sse/broadcaster';

const AddModeratorSchema = z.object({
  user_id: z.string().uuid(),
  can_mark_answered: z.boolean().default(false),
  can_star: z.boolean().default(false),
  can_flag: z.boolean().default(false),
  can_hide: z.boolean().default(false),
  can_mute: z.boolean().default(false),
  can_remove: z.boolean().default(false),
  can_approve: z.boolean().default(false),
});

const UpdatePermissionsSchema = z.object({
  can_mark_answered: z.boolean().optional(),
  can_star: z.boolean().optional(),
  can_flag: z.boolean().optional(),
  can_hide: z.boolean().optional(),
  can_mute: z.boolean().optional(),
  can_remove: z.boolean().optional(),
  can_approve: z.boolean().optional(),
});

/** Verify the caller is host, org owner, or org admin. */
async function requireHost(sessionId: string, callerId: string) {
  const result = await pool.query('SELECT id FROM sessions WHERE id = $1', [sessionId]);
  if (!result.rows[0]) throw new AppError(404, 'Session not found');
  await requireHostOrOrgAdmin(sessionId, callerId);
  return result.rows[0];
}

/**
 * GET /api/sessions/:id/moderators
 * List all moderators for a session (host only).
 */
export async function listModerators(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireHost(id, req.user!.userId);

    const result = await pool.query(
      `SELECT sm.id, sm.user_id, u.username, u.email,
              sm.can_mark_answered, sm.can_star, sm.can_flag, sm.can_hide,
              sm.can_mute, sm.can_remove, sm.can_approve,
              sm.assigned_at
       FROM session_moderators sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.session_id = $1
       ORDER BY sm.assigned_at`,
      [id],
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/sessions/:id/moderators
 * Add a moderator to a session (host only).
 */
export async function addModerator(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireHost(id, req.user!.userId);

    const data = AddModeratorSchema.parse(req.body);

    // Can't make the host a moderator
    const session = await pool.query('SELECT host_id FROM sessions WHERE id = $1', [id]);
    if (data.user_id === session.rows[0].host_id) {
      throw new AppError(400, 'The host cannot be assigned as a moderator');
    }

    // Verify the target user exists
    const userResult = await pool.query('SELECT id FROM users WHERE id = $1 AND is_guest = false', [data.user_id]);
    if (!userResult.rows[0]) throw new AppError(404, 'User not found');

    const result = await pool.query(
      `INSERT INTO session_moderators
         (session_id, user_id, can_mark_answered, can_star, can_flag, can_hide, can_mute, can_remove, can_approve)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (session_id, user_id) DO UPDATE SET
         can_mark_answered = EXCLUDED.can_mark_answered,
         can_star          = EXCLUDED.can_star,
         can_flag          = EXCLUDED.can_flag,
         can_hide          = EXCLUDED.can_hide,
         can_mute          = EXCLUDED.can_mute,
         can_remove        = EXCLUDED.can_remove,
         can_approve       = EXCLUDED.can_approve
       RETURNING *`,
      [id, data.user_id, data.can_mark_answered, data.can_star, data.can_flag, data.can_hide,
       data.can_mute, data.can_remove, data.can_approve],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/sessions/:id/moderators/:userId
 * Update a moderator's permissions (host only).
 */
export async function updateModeratorPermissions(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: sessionId, userId: targetUserId } = req.params;
    await requireHost(sessionId, req.user!.userId);

    const data = UpdatePermissionsSchema.parse(req.body);
    const fields = Object.keys(data).filter((k) => (data as any)[k] !== undefined);

    if (fields.length === 0) {
      res.json({ message: 'No changes' });
      return;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const values = fields.map((f) => (data as any)[f]);

    const result = await pool.query(
      `UPDATE session_moderators SET ${setClauses}
       WHERE session_id = $1 AND user_id = $2
       RETURNING *`,
      [sessionId, targetUserId, ...values],
    );

    if (!result.rows[0]) throw new AppError(404, 'Moderator not found');
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/sessions/:id/moderators/:userId
 * Remove a moderator from a session (host only).
 */
export async function removeModerator(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: sessionId, userId: targetUserId } = req.params;
    await requireHost(sessionId, req.user!.userId);

    const result = await pool.query(
      `DELETE FROM session_moderators WHERE session_id = $1 AND user_id = $2 RETURNING id`,
      [sessionId, targetUserId],
    );

    if (!result.rows[0]) throw new AppError(404, 'Moderator not found');
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/sessions/:id/participants/:participantId/mute
 * Mutes or unmutes a participant (host or mod with can_mute).
 */
export async function muteParticipant(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: sessionId, participantId } = req.params;
    const { mute } = z.object({ mute: z.boolean() }).parse(req.body);
    const callerId = req.user!.userId;

    const { role, permissions } = await resolveCallerRole(sessionId, callerId);
    if (role === 'participant' || role === 'none') throw new AppError(403, 'Insufficient permissions');
    if (role === 'moderator' && !permissions.can_mute) throw new AppError(403, 'Insufficient permissions');

    const result = await pool.query(
      `UPDATE session_participants
       SET is_muted = $1, muted_at = $2, muted_by = $3
       WHERE id = $4 AND session_id = $5
       RETURNING id, is_muted, user_id, guest_token`,
      [mute, mute ? new Date() : null, mute ? callerId : null, participantId, sessionId],
    );
    if (!result.rows[0]) throw new AppError(404, 'Participant not found');

    const { user_id, guest_token } = result.rows[0];
    broadcastTo(sessionId, user_id ?? null, guest_token ?? null, { type: 'participant:muted', data: { participantId, muted: mute } });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/sessions/:id/participants/:participantId
 * Removes a participant from the session (host or mod with can_remove).
 * Writes a session_bans row so they cannot rejoin.
 */
export async function removeParticipant(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: sessionId, participantId } = req.params;
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body);
    const callerId = req.user!.userId;

    const { role, permissions } = await resolveCallerRole(sessionId, callerId);
    if (role === 'participant' || role === 'none') throw new AppError(403, 'Insufficient permissions');
    if (role === 'moderator' && !permissions.can_remove) throw new AppError(403, 'Insufficient permissions');

    // Fetch the participant to get their user_id / guest_token
    const pResult = await pool.query(
      `SELECT user_id, guest_token FROM session_participants WHERE id = $1 AND session_id = $2`,
      [participantId, sessionId],
    );
    if (!pResult.rows[0]) throw new AppError(404, 'Participant not found');
    const { user_id, guest_token } = pResult.rows[0];

    // Record the ban so they cannot rejoin
    await pool.query(
      `INSERT INTO session_bans (session_id, user_id, guest_token, banned_by, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [sessionId, user_id, guest_token, callerId, reason ?? null],
    );

    // Remove them from participants
    await pool.query(
      `DELETE FROM session_participants WHERE id = $1`,
      [participantId],
    );

    broadcastTo(sessionId, user_id ?? null, guest_token ?? null, { type: 'participant:removed', data: { participantId } });
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
}
