import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { requireHostOrOrgAdmin, resolveCallerRole } from '../db/permissions';
import { broadcast } from '../sse/broadcaster';
import { createNotificationsForUsers } from './notificationController';
import { sendSessionLive } from '../lib/mailer';

const CreateSessionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
  credits_per_user: z.number().int().min(1).max(5).default(3),
  starts_at: z.string().optional(),
  org_id: z.string().uuid().optional(),
  submission_cutoff_at: z.string().optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  is_online: z.boolean().optional(),
});

const UpdateSessionSchema = CreateSessionSchema.partial();

function makeSlug(title: string): string {
  const base = slugify(title, { lower: true, strict: true }).slice(0, 80);
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

/**
 * Generates a unique join code.
 * If a prefix is provided (from host/org profile), appends 3 random
 * uppercase alphanumeric chars: "KGMZ" → "KGMZ7X4".
 * Otherwise generates a random 6-char code: "AW3F9Q".
 */
function makeJoinCode(prefix?: string | null): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  const randomPart = Array.from({ length: prefix ? 3 : 6 })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join('');
  return prefix ? `${prefix.toUpperCase()}${randomPart}` : randomPart;
}

export async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    const data = CreateSessionSchema.parse(req.body);
    const hostId = req.user!.userId;
    const slug = makeSlug(data.title);

    // If org_id is provided, verify caller is an org owner or admin
    // and pull the org's code_prefix if set
    let codePrefix: string | null = null;
    if (data.org_id) {
      const orgCheck = await pool.query(
        `SELECT om.role, o.code_prefix
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.org_id = $1 AND om.user_id = $2`,
        [data.org_id, hostId],
      );
      const role = orgCheck.rows[0]?.role;
      if (role !== 'owner' && role !== 'admin') {
        throw new AppError(403, 'You must be an org owner or admin to create sessions for this organization');
      }
      codePrefix = orgCheck.rows[0]?.code_prefix ?? null;
    } else {
      // Fall back to host's personal prefix
      const userCheck = await pool.query('SELECT code_prefix FROM users WHERE id = $1', [hostId]);
      codePrefix = userCheck.rows[0]?.code_prefix ?? null;
    }

    // Generate a unique join code (retry on collision)
    let joinCode = makeJoinCode(codePrefix);
    let unique = false;
    for (let i = 0; i < 5; i++) {
      const exists = await pool.query('SELECT id FROM sessions WHERE join_code = $1', [joinCode]);
      if (!exists.rows[0]) { unique = true; break; }
      joinCode = makeJoinCode(codePrefix);
    }
    if (!unique) throw new AppError(500, 'Could not generate a unique join code — please try again');

    const result = await pool.query(
      `INSERT INTO sessions
         (host_id, org_id, title, description, visibility, credits_per_user, slug,
          join_code, starts_at, submission_cutoff_at, city, region, country, lat, lng, is_online)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        hostId,
        data.org_id ?? null,
        data.title,
        data.description ?? null,
        data.visibility,
        data.credits_per_user,
        slug,
        joinCode,
        data.starts_at ?? null,
        data.submission_cutoff_at ?? null,
        data.city ?? null,
        data.region ?? null,
        data.country ?? null,
        data.lat ?? null,
        data.lng ?? null,
        data.is_online ?? false,
      ],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function getSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `SELECT s.*, u.username as host_username,
              o.name as org_name, o.slug as org_slug, o.is_verified as org_is_verified,
              o.avatar_url as org_avatar_url,
              COUNT(DISTINCT sp.id)::int AS participant_count,
              COUNT(DISTINCT q.id)::int  AS question_count,
              COALESCE(SUM(q.vote_count), 0)::int AS total_echoes
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       LEFT JOIN organizations o ON o.id = s.org_id
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       LEFT JOIN questions q ON q.session_id = s.id AND q.status != 'hidden'
       WHERE s.slug = $1
       GROUP BY s.id, u.username, o.name, o.slug, o.is_verified, o.avatar_url`,
      [slug],
    );

    if (!result.rows[0]) throw new AppError(404, 'Session not found');

    const session = result.rows[0];

    // Block private sessions for non-hosts (future: invite list)
    if (session.visibility === 'private' && req.user?.userId !== session.host_id) {
      throw new AppError(403, 'This session is private');
    }

    // Attach caller's role so the frontend can render host/mod controls
    let caller_role = 'none';
    if (req.user && !req.user.isGuest) {
      const resolved = await resolveCallerRole(session.id, req.user.userId);
      caller_role = resolved.role;
    }

    res.json({ ...session, caller_role });
  } catch (err) {
    next(err);
  }
}

export async function updateSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = UpdateSessionSchema.parse(req.body);

    const sessionResult = await pool.query('SELECT id FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    await requireHostOrOrgAdmin(id, req.user!.userId);

    // If reassigning to a different org, verify caller is a member of that org
    if (data.org_id !== undefined) {
      if (data.org_id !== null) {
        const orgCheck = await pool.query(
          `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
          [data.org_id, req.user!.userId],
        );
        const role = orgCheck.rows[0]?.role;
        if (role !== 'owner' && role !== 'admin') {
          throw new AppError(403, 'You must be an owner or admin of the target channel');
        }
      }
    }

    const fields = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);

    if (fields.length === 0) {
      res.json({ message: 'No changes' });
      return;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map((f) => (data as any)[f]);

    const result = await pool.query(
      `UPDATE sessions SET ${setClauses} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function goLive(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query('SELECT id, status FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    if (sessionResult.rows[0].status === 'closed') throw new AppError(400, 'Session is already closed');
    if (sessionResult.rows[0].status === 'live') throw new AppError(400, 'Session is already live');

    await requireHostOrOrgAdmin(id, req.user!.userId);

    const result = await pool.query(
      `UPDATE sessions SET status = 'live' WHERE id = $1 RETURNING *`,
      [id],
    );

    broadcast(id, { type: 'session:live', data: {} });

    res.json(result.rows[0]);

    // Fan out notifications + emails to org followers (fire-and-forget — never blocks response)
    notifyOrgFollowers(result.rows[0]).catch(err =>
      console.error('[goLive] notification fan-out failed:', err),
    );
  } catch (err) {
    next(err);
  }
}

/** Notify all followers of a session's org that the session is now live. */
async function notifyOrgFollowers(session: {
  id: string; title: string; slug: string; org_id: string | null;
}) {
  if (!session.org_id) return;

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  // Fetch org name + all registered followers (with email for mailer)
  const { rows } = await pool.query(
    `SELECT of2.user_id, u.email, o.name AS org_name, o.slug AS org_slug
     FROM org_followers of2
     JOIN users u ON u.id = of2.user_id AND u.is_guest = false
     JOIN organizations o ON o.id = of2.org_id
     WHERE of2.org_id = $1`,
    [session.org_id],
  );

  if (!rows.length) return;

  const orgName  = rows[0].org_name  as string;
  const orgSlug  = rows[0].org_slug  as string;
  const followerIds = rows.map((r: any) => r.user_id as string);

  // In-app notifications (single batch insert)
  await createNotificationsForUsers(followerIds, 'session:live', {
    session_id:    session.id,
    session_slug:  session.slug,
    session_title: session.title,
    org_name:      orgName,
    org_slug:      orgSlug,
  });

  // Emails (one per follower, settle independently)
  const sessionUrl = `${appUrl}/s/${session.slug}`;
  await Promise.allSettled(
    rows.map((r: any) =>
      sendSessionLive(r.email as string, {
        orgName,
        sessionTitle: session.title,
        sessionUrl,
      }),
    ),
  );
}

export async function reopenSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query('SELECT id, status FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    if (sessionResult.rows[0].status !== 'closed') throw new AppError(400, 'Session is not closed');

    await requireHostOrOrgAdmin(id, req.user!.userId);

    const result = await pool.query(
      // Also clear ends_at and any past submission_cutoff_at so participants can submit again
      `UPDATE sessions
       SET status = 'live',
           ends_at = NULL,
           submission_cutoff_at = CASE
             WHEN submission_cutoff_at IS NOT NULL AND submission_cutoff_at <= NOW()
             THEN NULL
             ELSE submission_cutoff_at
           END
       WHERE id = $1 RETURNING *`,
      [id],
    );

    broadcast(id, { type: 'session:live', data: {} });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function closeSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query('SELECT id FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    await requireHostOrOrgAdmin(id, req.user!.userId);

    const result = await pool.query(
      `UPDATE sessions SET status = 'closed', ends_at = NOW() WHERE id = $1 RETURNING *`,
      [id],
    );

    broadcast(id, { type: 'session:closed', data: {} });

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

const JoinSchema = z.object({
  guest_username: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(30, 'Name must be 30 characters or fewer')
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores allowed')
    .optional(),
});

export async function joinSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) {
      throw new AppError(401, 'Authentication required to join a session');
    }

    const { guest_username } = JoinSchema.parse(req.body);

    // Guests must supply a display name
    if (!userId) {
      if (!guest_username) throw new AppError(400, 'A display name is required to join');

      // Block names already claimed by registered users
      const taken = await pool.query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND is_guest = false`,
        [guest_username],
      );
      if ((taken.rowCount ?? 0) > 0) {
        throw new AppError(409, 'That name is taken by a registered user — pick another or sign in');
      }
    }

    const sessionResult = await pool.query(
      'SELECT id, credits_per_user, status, visibility, host_id FROM sessions WHERE id = $1',
      [id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    const { credits_per_user, status, visibility, host_id } = sessionResult.rows[0];

    if (status === 'closed') throw new AppError(410, 'This session is closed');

    // Block platform-banned users/guests from joining any session
    if (userId) {
      const ban = await pool.query(
        `SELECT id FROM platform_bans
         WHERE user_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [userId],
      );
      if (ban.rows[0]) throw new AppError(403, 'Your account has been suspended from GuestSpeak');
    } else if (guestToken) {
      const ban = await pool.query(
        `SELECT id FROM platform_bans
         WHERE guest_token = $1 AND (expires_at IS NULL OR expires_at > NOW())
         LIMIT 1`,
        [guestToken],
      );
      if (ban.rows[0]) throw new AppError(403, 'This device has been suspended from GuestSpeak');
    }

    // Block non-hosts from joining private sessions
    if (visibility === 'private' && userId !== host_id) {
      throw new AppError(403, 'This session is private');
    }

    const credits = credits_per_user;

    // Upsert participant (idempotent).
    // NULL values don't match unique constraints, so we branch on identity type.
    let credits_remaining: number;

    if (userId) {
      const result = await pool.query(
        `INSERT INTO session_participants (session_id, user_id, credits_remaining)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, user_id) DO UPDATE SET session_id = EXCLUDED.session_id
         RETURNING credits_remaining`,
        [id, userId, credits],
      );
      credits_remaining = result.rows[0].credits_remaining;
    } else {
      const result = await pool.query(
        `INSERT INTO session_participants (session_id, guest_token, credits_remaining, guest_username)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, guest_token) DO UPDATE
           SET guest_username = EXCLUDED.guest_username
         RETURNING credits_remaining`,
        [id, guestToken, credits, guest_username],
      );
      credits_remaining = result.rows[0].credits_remaining;
    }

    // Broadcast updated participant count to everyone watching the session
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM session_participants WHERE session_id = $1',
      [id],
    );
    broadcast(id, { type: 'participant:count', data: { count: countResult.rows[0].count } });

    res.json({ joined: true, credits_remaining });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/sessions/code/:code
 * Look up a session by its short join code (case-insensitive).
 * Used when an audience member types the code they heard on air.
 */
export async function getSessionByCode(req: Request, res: Response, next: NextFunction) {
  try {
    const code = req.params.code.toUpperCase();

    const result = await pool.query(
      `SELECT s.*, u.username as host_username,
              o.name as org_name, o.slug as org_slug
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.join_code = $1`,
      [code],
    );

    if (!result.rows[0]) throw new AppError(404, 'No session found with that code');

    const session = result.rows[0];
    if (session.status === 'closed') throw new AppError(410, 'This session has ended');

    // Block private sessions for non-hosts (mirrors the slug-based getSession check)
    if (session.visibility === 'private') {
      const callerId = req.user?.isGuest === false ? req.user.userId : null;
      if (callerId !== session.host_id) throw new AppError(403, 'This session is private');
    }

    res.json(session);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/sessions/:id — permanently delete a session (host only) */
export async function deleteSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const sessionResult = await pool.query('SELECT id FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    await requireHostOrOrgAdmin(id, req.user!.userId);

    // Cascades to questions, participants, etc. via DB FK constraints
    await pool.query('DELETE FROM sessions WHERE id = $1', [id]);

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/sessions/:id/export — download Q&A as CSV (host/org_admin only) */
export async function exportSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireHostOrOrgAdmin(id, req.user!.userId);

    const sessionResult = await pool.query(
      `SELECT s.title, s.ends_at, s.created_at FROM sessions WHERE id = $1`,
      [id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    const { title } = sessionResult.rows[0];

    const questionsResult = await pool.query(
      `SELECT q.body, q.vote_count, q.status, q.is_pinned, q.host_reply,
              q.host_replied_at, q.created_at,
              COALESCE(u.username, sp.guest_username) AS author
       FROM questions q
       LEFT JOIN users u ON u.id = q.author_id
       LEFT JOIN session_participants sp
         ON sp.session_id = q.session_id
         AND sp.guest_token = q.author_guest_token
         AND q.author_guest_token IS NOT NULL
       WHERE q.session_id = $1 AND q.status != 'hidden'
       ORDER BY q.is_pinned DESC, q.vote_count DESC, q.created_at ASC`,
      [id],
    );

    // Build CSV
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Question', 'Echoes', 'Status', 'Pinned', 'Author', 'Host Reply', 'Asked At'];
    const rows = questionsResult.rows.map(q => [
      escape(q.body),
      q.vote_count,
      escape(q.status),
      q.is_pinned ? 'Yes' : 'No',
      escape(q.author ?? 'Anonymous'),
      escape(q.host_reply ?? ''),
      escape(new Date(q.created_at).toISOString()),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_qa.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pool.query(
      `SELECT s.id, s.title, s.description, s.slug, s.status, s.visibility,
              s.created_at, u.username as host_username
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       WHERE s.visibility = 'public' AND s.status != 'closed'
       ORDER BY s.created_at DESC
       LIMIT 50`,
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/** GET /api/sessions/mine — all sessions hosted by the caller */
export async function listMySessions(req: Request, res: Response, next: NextFunction) {
  try {
    const callerId = req.user!.userId;
    const result = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.visibility, s.join_code,
              s.starts_at, s.created_at,
              COUNT(DISTINCT sp.id)::int AS participant_count,
              COUNT(DISTINCT q.id)::int  AS question_count,
              o.name AS org_name
       FROM sessions s
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       LEFT JOIN questions q ON q.session_id = s.id AND q.status != 'hidden'
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.host_id = $1
       GROUP BY s.id, o.name
       ORDER BY
         CASE s.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
         s.created_at DESC
       LIMIT 100`,
      [callerId],
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    next(err);
  }
}
