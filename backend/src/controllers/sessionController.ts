import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { requireHostOrOrgAdmin, resolveCallerRole } from '../db/permissions';
import { broadcast } from '../sse/broadcaster';
import { createNotificationsForUsers } from './notificationController';
import { rejectIfBanned } from '../lib/wordFilter';
import { sendSessionLive } from '../lib/mailer';

const CreateSessionSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
  credits_per_user: z.number().int().min(1).max(6).default(6),
  starts_at: z.string().optional(),
  org_id: z.string().uuid().optional(),
  submission_cutoff_at: z.string().optional(),
  city: z.string().max(100).optional(),
  region: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  is_online: z.boolean().optional(),
  stream_url: z.string().url().max(1000)
    .refine(u => new URL(u).protocol === 'https:', { message: 'stream_url must use https' })
    .optional().or(z.literal('')),
  requires_approval: z.boolean().optional(),
});

const UpdateSessionSchema = CreateSessionSchema.partial();

/** Roles allowed to see and act on a private session. */
const ELEVATED_ROLES: readonly string[] = ['host', 'org_owner', 'org_admin', 'moderator'];

/**
 * Above this many participants a session stops pushing every event to every
 * client and the audience polls a cached feed instead.
 *
 * Per-event SSE fan-out costs one socket write per connected client per event,
 * in one process. That is the right trade for a room of 50 and the wrong one for
 * a stadium, where a single echo would mean tens of thousands of writes. Polling
 * a short-TTL cache turns unbounded fan-out into a fixed cost per interval.
 *
 * Hosts and moderators always keep the live stream regardless of size — there are
 * a handful of them, and they are the ones who need immediacy.
 */
const LIVE_FEED_MAX_PARTICIPANTS = parseInt(process.env.LIVE_FEED_MAX_PARTICIPANTS ?? '400', 10);
const FEED_POLL_INTERVAL_MS = parseInt(process.env.FEED_POLL_INTERVAL_MS ?? '5000', 10);

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
  const length = prefix ? 3 : 6;
  // Crypto-random, not Math.random: for unlisted sessions the join code IS the
  // access control, so it must not be predictable from other issued codes.
  // 32 chars is a power of two, so byte % 32 is unbiased.
  const bytes = randomBytes(length);
  const randomPart = Array.from(bytes, b => chars[b % chars.length]).join('');
  return prefix ? `${prefix.toUpperCase()}${randomPart}` : randomPart;
}

export async function createSession(req: Request, res: Response, next: NextFunction) {
  try {
    const data = CreateSessionSchema.parse(req.body);
    await rejectIfBanned(data.title);
    if (data.description) await rejectIfBanned(data.description);
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
          join_code, starts_at, submission_cutoff_at, city, region, country, lat, lng, is_online, stream_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
        data.stream_url || null,
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

    // Counts come from correlated subqueries, not joins. Joining participants
    // and questions together multiplies the rows (participants × questions),
    // which both inflates SUM(vote_count) and makes the query cost explode on
    // a busy session.
    const result = await pool.query(
      `SELECT s.*, u.username as host_username,
              o.name as org_name, o.slug as org_slug, o.is_verified as org_is_verified,
              o.avatar_url as org_avatar_url,
              (SELECT COUNT(*)::int FROM session_participants sp
                WHERE sp.session_id = s.id) AS participant_count,
              (SELECT COUNT(*)::int FROM questions q
                WHERE q.session_id = s.id AND q.status != 'hidden') AS question_count,
              (SELECT COALESCE(SUM(q.vote_count), 0)::int FROM questions q
                WHERE q.session_id = s.id AND q.status != 'hidden') AS total_echoes
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.slug = $1`,
      [slug],
    );

    if (!result.rows[0]) throw new AppError(404, 'Session not found');

    const session = result.rows[0];

    // Attach caller's role so the frontend can render host/mod controls.
    // For moderator callers, also include their specific permission set so the
    // frontend can gate mute/remove/approve buttons without an extra round-trip.
    let caller_role = 'none';
    let mod_permissions: Record<string, boolean> | null = null;
    if (req.user && !req.user.isGuest) {
      const resolved = await resolveCallerRole(session.id, req.user.userId);
      caller_role = resolved.role;
      if (resolved.role === 'moderator') {
        mod_permissions = resolved.permissions as unknown as Record<string, boolean>;
      }
    }

    // Block private sessions for anyone without elevated access.
    // Hosts, org owners/admins, and explicitly assigned moderators may enter.
    if (session.visibility === 'private' && !ELEVATED_ROLES.includes(caller_role)) {
      throw new AppError(403, 'This session is private');
    }

    // Tell the client how to follow this session: stream every event, or poll the
    // cached feed. Deciding server-side keeps the threshold in one place and lets
    // it change without shipping a new frontend.
    const isElevatedCaller = ELEVATED_ROLES.includes(caller_role);
    const feed_mode: 'live' | 'polling' =
      isElevatedCaller || session.participant_count <= LIVE_FEED_MAX_PARTICIPANTS
        ? 'live'
        : 'polling';

    res.json({
      ...session,
      caller_role,
      feed_mode,
      poll_interval_ms: FEED_POLL_INTERVAL_MS,
      ...(mod_permissions ? { mod_permissions } : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function updateSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const data = UpdateSessionSchema.parse(req.body);
    if (data.title) await rejectIfBanned(data.title);
    if (data.description) await rejectIfBanned(data.description);

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
    const ipAddress = req.ip ?? null;

    // Guests must supply a display name
    if (!userId) {
      if (!guest_username) throw new AppError(400, 'A display name is required to join');
      await rejectIfBanned(guest_username);

      // Block names already claimed by registered users
      const taken = await pool.query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND is_guest = false`,
        [guest_username],
      );
      if ((taken.rowCount ?? 0) > 0) {
        throw new AppError(409, 'That name is taken by a registered user — pick another or sign in');
      }
    }
    // If a guest is choosing a username, check it isn't already claimed by another
    // guest in this same session. Reconnects (same guest_token) are allowed through.
    if (!userId && guest_username && guestToken) {
      const sessionResult2 = await pool.query(
        `SELECT id FROM session_participants
         WHERE session_id = $1 AND LOWER(guest_username) = LOWER($2) AND guest_token != $3`,
        [id, guest_username, guestToken],
      );
      if ((sessionResult2.rowCount ?? 0) > 0) {
        throw new AppError(409, 'That display name is already taken in this session — please choose another');
      }
    }

    const sessionResult = await pool.query(
      'SELECT id, credits_per_user, status, visibility, host_id FROM sessions WHERE id = $1',
      [id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    const { credits_per_user, status, visibility, host_id } = sessionResult.rows[0];

    if (status === 'closed') throw new AppError(410, 'This session is closed');

    // Block platform-banned users/guests from joining any session.
    // Checks user_id, guest_token, AND IP so all three ban vectors are enforced.
    {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (userId) {
        params.push(userId);
        conditions.push(`user_id = $${params.length}`);
      }
      if (guestToken) {
        params.push(guestToken);
        conditions.push(`guest_token = $${params.length}`);
      }
      if (ipAddress) {
        params.push(ipAddress);
        conditions.push(`ip_address = $${params.length}`);
      }

      if (conditions.length > 0) {
        const ban = await pool.query(
          `SELECT id FROM platform_bans
           WHERE (${conditions.join(' OR ')}) AND (expires_at IS NULL OR expires_at > NOW())
           LIMIT 1`,
          params,
        );
        if (ban.rows[0]) {
          throw new AppError(403, 'This account or device has been suspended from GuestSpeak');
        }
      }
    }

    // Block non-elevated callers from joining private sessions.
    // Mirrors getSession's check: org owners/admins and assigned moderators can
    // enter, otherwise they'd load the page and then fail to join it.
    if (visibility === 'private' && userId !== host_id) {
      const { role } = userId
        ? await resolveCallerRole(id, userId)
        : { role: 'none' as const };
      if (!ELEVATED_ROLES.includes(role)) {
        throw new AppError(403, 'This session is private');
      }
    }

    // Per-session cap on distinct guest tokens sharing one IP. Blunts the
    // farming loop (mint token → join → spend credits → repeat).
    //
    // IMPORTANT: this only works when an IP maps to roughly one person. That
    // holds for a home connection and breaks completely at venue scale — a
    // conference NAT or a stadium's carrier-grade NAT puts thousands of real,
    // distinct attendees behind a handful of addresses. A low cap there locks
    // out the whole room, so the default is set for the large-venue case and
    // GUEST_IP_TOKEN_CAP=0 disables the check entirely for ticketed events.
    //
    // At stadium scale, IP is not a usable identity signal in either direction:
    // a farming loop and a filling arena look the same from here. Ballot-stuffing
    // defence for events that large has to come from requiring sign-in to Echo,
    // not from this check.
    const IP_TOKEN_CAP = parseInt(process.env.GUEST_IP_TOKEN_CAP ?? '2000', 10);
    if (IP_TOKEN_CAP > 0 && !userId && guestToken && ipAddress) {
      const existing = await pool.query(
        `SELECT COUNT(DISTINCT guest_token)::int AS cnt
         FROM session_participants
         WHERE session_id = $1 AND ip_address = $2 AND guest_token != $3`,
        [id, ipAddress, guestToken],
      );
      if ((existing.rows[0]?.cnt ?? 0) >= IP_TOKEN_CAP) {
        throw new AppError(429, 'Too many guest accounts joined from this network — sign in to continue');
      }
    }

    // Everyone starts with the full host-set credits.
    // The regen heartbeat later caps guests at 2 and signed-in users at 6.
    const credits = credits_per_user;

    // Upsert participant (idempotent).
    // NULL values don't match unique constraints, so we branch on identity type.
    // ip_address is recorded on first join and not overwritten on reconnect
    // (DO UPDATE leaves ip_address unchanged).
    let credits_remaining: number;

    let anon_credits: number = 2;

    if (userId) {
      const result = await pool.query(
        `INSERT INTO session_participants (session_id, user_id, credits_remaining, ip_address)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, user_id) DO UPDATE SET session_id = EXCLUDED.session_id
         RETURNING credits_remaining, anon_credits`,
        [id, userId, credits, ipAddress],
      );
      credits_remaining = result.rows[0].credits_remaining;
      anon_credits      = result.rows[0].anon_credits;
    } else {
      const result = await pool.query(
        `INSERT INTO session_participants (session_id, guest_token, credits_remaining, guest_username, ip_address)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, guest_token) DO UPDATE
           SET guest_username = EXCLUDED.guest_username
         RETURNING credits_remaining, anon_credits`,
        [id, guestToken, credits, guest_username, ipAddress],
      );
      credits_remaining = result.rows[0].credits_remaining;
      anon_credits      = result.rows[0].anon_credits;
    }

    // Broadcast updated participant count to everyone watching the session
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM session_participants WHERE session_id = $1',
      [id],
    );
    broadcast(id, { type: 'participant:count', data: { count: countResult.rows[0].count } });

    res.json({ joined: true, credits_remaining, anon_credits });
  } catch (err) {
    next(err);
  }
}

const GUEST_REGEN_LIMIT  = 2;   // Guests get at most 2 regen credits lifetime per session, then must sign up
const GUEST_CREDIT_CAP   = 2;   // …and regen never takes a guest above this ceiling
const USER_CREDIT_CAP    = 6;   // Signed-in users regen up to this ceiling
const CREDIT_REGEN_MINUTES = 10;

/**
 * POST /api/sessions/:id/heartbeat
 * Called by the frontend every 10 minutes while a participant is in the session.
 *
 * Registered users: awards 1 credit if below USER_CREDIT_CAP. No lifetime limit.
 * Guests: awards 1 credit if below GUEST_CREDIT_CAP *and* they have not yet used
 *   GUEST_REGEN_LIMIT lifetime regens. The two guards do different jobs — the
 *   ceiling stops the balance drifting above the guest tier, the lifetime count
 *   is what eventually forces the sign-up prompt.
 *
 * The ceiling is enforced in the WHERE clause, not just via LEAST, so a guest
 * who still holds more than the cap (a host may start everyone at up to 6) is
 * simply skipped rather than having their balance pulled down to it.
 */
export async function heartbeat(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId     = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required');

    let credits_remaining: number;
    let regen_exhausted = false;
    let next_credit_secs: number = CREDIT_REGEN_MINUTES * 60;

    if (userId) {
      // Registered users: ceiling-based regen up to USER_CREDIT_CAP
      await pool.query(
        `UPDATE session_participants
         SET credits_remaining = LEAST(credits_remaining + 1, $1),
             last_credit_at    = NOW()
         WHERE session_id = $2
           AND user_id    = $3
           AND credits_remaining < $1
           AND (last_credit_at IS NULL OR last_credit_at < NOW() - INTERVAL '${CREDIT_REGEN_MINUTES} minutes')`,
        [USER_CREDIT_CAP, id, userId],
      );
      const cur = await pool.query(
        `SELECT credits_remaining,
                GREATEST(0, EXTRACT(EPOCH FROM (
                  COALESCE(last_credit_at, NOW() - INTERVAL '${CREDIT_REGEN_MINUTES} minutes')
                  + INTERVAL '${CREDIT_REGEN_MINUTES} minutes' - NOW()
                ))::int AS next_credit_secs
         FROM session_participants WHERE session_id = $1 AND user_id = $2`,
        [id, userId],
      );
      credits_remaining = cur.rows[0]?.credits_remaining ?? 0;
      next_credit_secs  = cur.rows[0]?.next_credit_secs ?? next_credit_secs;
    } else {
      // Guests: lifetime cap of GUEST_REGEN_LIMIT regen credits — after that, sign up to get more
      await pool.query(
        `UPDATE session_participants
         SET credits_remaining = LEAST(credits_remaining + 1, $4),
             last_credit_at    = NOW(),
             regen_count       = regen_count + 1
         WHERE session_id  = $2
           AND guest_token = $3
           AND regen_count < $1
           AND credits_remaining < $4
           AND (last_credit_at IS NULL OR last_credit_at < NOW() - INTERVAL '${CREDIT_REGEN_MINUTES} minutes')`,
        [GUEST_REGEN_LIMIT, id, guestToken, GUEST_CREDIT_CAP],
      );
      const cur = await pool.query(
        `SELECT credits_remaining, regen_count,
                GREATEST(0, EXTRACT(EPOCH FROM (
                  COALESCE(last_credit_at, NOW() - INTERVAL '${CREDIT_REGEN_MINUTES} minutes')
                  + INTERVAL '${CREDIT_REGEN_MINUTES} minutes' - NOW()
                ))::int AS next_credit_secs
         FROM session_participants WHERE session_id = $1 AND guest_token = $2`,
        [id, guestToken],
      );
      credits_remaining = cur.rows[0]?.credits_remaining ?? 0;
      regen_exhausted   = (cur.rows[0]?.regen_count ?? 0) >= GUEST_REGEN_LIMIT;
      next_credit_secs  = cur.rows[0]?.next_credit_secs ?? next_credit_secs;
    }

    res.json({ credits_remaining, regen_exhausted, next_credit_secs });
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

/** POST /api/sessions/:id/report — submit a report for admin review (any authenticated user except the host) */
export async function reportSession(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const userId     = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required to report a session');

    const { reason, details } = z.object({
      reason:  z.enum(['spam', 'inappropriate', 'impersonation', 'misinformation', 'other']),
      details: z.string().max(500).optional(),
    }).parse(req.body);

    // Can't report your own session
    const sessionResult = await pool.query('SELECT host_id FROM sessions WHERE id = $1', [id]);
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    if (sessionResult.rows[0].host_id === userId) throw new AppError(403, 'You cannot report your own session');

    await pool.query(
      `INSERT INTO session_reports (session_id, reporter_user_id, reporter_guest_token, reason, details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [id, userId, guestToken, reason, details ?? null],
    );

    res.status(201).json({ reported: true });
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
      `SELECT s.title, s.ends_at, s.created_at FROM sessions s WHERE s.id = $1`,
      [id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');
    const { title } = sessionResult.rows[0];

    const questionsResult = await pool.query(
      `SELECT q.body, q.vote_count, q.status, q.is_pinned, q.host_reply,
              q.host_replied_at, q.created_at,
              CASE
                WHEN q.post_anonymously THEN 'Anon' || q.anon_number
                ELSE COALESCE(q.author_display_name, u.username, sp.guest_username, 'Removed participant')
              END AS author
       FROM questions q
       LEFT JOIN users u ON u.id = q.author_id AND NOT q.post_anonymously
       LEFT JOIN session_participants sp
         ON sp.session_id = q.session_id
         AND NOT q.post_anonymously
         AND q.author_guest_token IS NOT NULL
         AND sp.guest_token = q.author_guest_token
       WHERE q.session_id = $1 AND q.status NOT IN ('hidden', 'pending')
       ORDER BY q.is_pinned DESC, q.vote_count DESC, q.created_at ASC`,
      [id],
    );

    // Build CSV.
    // Values starting with = + - @ (or a leading tab/CR) are treated as formulas
    // by Excel/Sheets, so a question body like `=HYPERLINK(...)` would execute
    // when the host opens the export. Prefix those with a single quote.
    const escape = (v: any) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
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

/** GET /api/sessions/attended — sessions the caller attended as a participant (not host) */
export async function listAttendedSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const result = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.created_at, s.starts_at,
              u.username AS host_username,
              COUNT(DISTINCT q.id)::int AS question_count
       FROM session_participants sp
       JOIN sessions s ON s.id = sp.session_id
       JOIN users u ON u.id = s.host_id
       LEFT JOIN questions q ON q.session_id = s.id AND q.author_id = $1
       WHERE sp.user_id = $1 AND s.host_id != $1
       GROUP BY s.id, s.title, s.slug, s.status, s.created_at, s.starts_at, u.username, sp.joined_at
       ORDER BY sp.joined_at DESC
       LIMIT 10`,
      [userId],
    );
    res.json({ sessions: result.rows });
  } catch (err) { next(err); }
}

/** GET /api/sessions/mine — all sessions hosted by the caller */
export async function listMySessions(req: Request, res: Response, next: NextFunction) {
  try {
    const callerId = req.user!.userId;
    const result = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.visibility, s.join_code,
              s.starts_at, s.created_at,
              (SELECT COUNT(*)::int FROM session_participants sp
                WHERE sp.session_id = s.id) AS participant_count,
              (SELECT COUNT(*)::int FROM questions q
                WHERE q.session_id = s.id AND q.status != 'hidden') AS question_count,
              o.name AS org_name
       FROM sessions s
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.host_id = $1
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
