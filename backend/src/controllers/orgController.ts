import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { randomBytes } from 'crypto';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  // avatar_url is a relative path from our own upload system — not user-entered, no URL format required
  avatar_url: z.string().optional(),
  // website is user-entered; strip empty strings before validating
  website: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
  city:    z.string().max(100).optional(),
  region:  z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  lat:     z.number().min(-90).max(90).optional(),
  lng:     z.number().min(-180).max(180).optional(),
  categories: z.array(z.string().max(50)).max(12).optional(),
  is_online:  z.boolean().optional(),
});

const UpdateOrgSchema = CreateOrgSchema.partial();

const AddMemberSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
});

function makeOrgSlug(name: string) {
  const base = slugify(name, { lower: true, strict: true }).slice(0, 80);
  const suffix = randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

async function requireOrgOwner(orgId: string, callerId: string) {
  const result = await pool.query(
    `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, callerId],
  );
  if (result.rows[0]?.role !== 'owner') throw new AppError(403, 'Only a channel owner can do this');
}

async function requireOrgOwnerOrAdmin(orgId: string, callerId: string) {
  const result = await pool.query(
    `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, callerId],
  );
  const role = result.rows[0]?.role;
  if (role !== 'owner' && role !== 'admin') throw new AppError(403, 'Only a channel owner or admin can do this');
}

/** POST /api/orgs — create an org, caller becomes owner */
export async function createOrg(req: Request, res: Response, next: NextFunction) {
  try {
    const data = CreateOrgSchema.parse(req.body);
    const callerId = req.user!.userId;

    // Cap: free accounts can own at most 3 channels
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM organization_members WHERE user_id = $1 AND role = 'owner'`,
      [callerId],
    );
    if (parseInt(countResult.rows[0].count, 10) >= 3) {
      throw new AppError(403, 'You can only own up to 3 channels. Upgrade to Pro for unlimited.');
    }

    const slug = makeOrgSlug(data.name);

    const orgResult = await pool.query(
      `INSERT INTO organizations (name, slug, description, avatar_url, website, city, region, country, lat, lng, categories, is_online)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [data.name, slug, data.description ?? null, data.avatar_url ?? null, data.website ?? null,
       data.city ?? null, data.region ?? null, data.country ?? null, data.lat ?? null, data.lng ?? null,
       data.categories ?? [], data.is_online ?? false],
    );

    const org = orgResult.rows[0];

    // Automatically add creator as owner
    await pool.query(
      `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'owner')`,
      [org.id, callerId],
    );

    res.status(201).json(org);
  } catch (err: any) {
    if (err?.code === '23505') next(new AppError(409, 'An organization with that name already exists'));
    else next(err);
  }
}

/** GET /api/orgs/:slug — public org profile + upcoming/live sessions */
export async function getOrg(req: Request, res: Response, next: NextFunction) {
  try {
    const { slug } = req.params;
    const callerId = req.user?.isGuest === false ? req.user.userId : null;

    const orgResult = await pool.query(
      // Counts registered followers only, and the join is what enforces it.
      // The route now refuses guests, but rows created while it did not are
      // still here, and the count is what the public sees — it should agree
      // with the go-live fan-out, which has always filtered guests.
      `SELECT o.*,
              COUNT(DISTINCT fu.id)::int AS follower_count,
              -- Whether this caller already follows. Without it the button
              -- always rendered "Follow", so someone who followed last week
              -- was invited to do it again on every visit.
              ($2::uuid IS NOT NULL AND EXISTS (
                SELECT 1 FROM org_followers f
                 WHERE f.org_id = o.id AND f.user_id = $2
              )) AS is_following
       FROM organizations o
       LEFT JOIN org_followers of2 ON of2.org_id = o.id
       LEFT JOIN users fu ON fu.id = of2.user_id AND fu.is_guest = false
       WHERE o.slug = $1
       GROUP BY o.id`,
      [slug, callerId],
    );
    if (!orgResult.rows[0]) throw new AppError(404, 'Channel not found');
    const org = orgResult.rows[0];

    const sessionsResult = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.visibility,
              s.city, s.region, s.starts_at, s.created_at,
              u.username as host_username
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       WHERE s.org_id = $1 AND s.visibility = 'public' AND s.status != 'closed'
       ORDER BY s.starts_at ASC NULLS LAST, s.created_at DESC
       LIMIT 20`,
      [org.id],
    );

    const pastSessionsResult = await pool.query(
      `SELECT s.id, s.title, s.slug, s.status, s.visibility,
              s.city, s.ends_at, s.created_at,
              u.username as host_username,
              (SELECT COUNT(*)::int FROM session_participants sp
                WHERE sp.session_id = s.id) AS participant_count,
              (SELECT COUNT(*)::int FROM questions q
                WHERE q.session_id = s.id AND q.status != 'hidden') AS question_count
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       WHERE s.org_id = $1 AND s.visibility = 'public' AND s.status = 'closed'
       ORDER BY s.ends_at DESC NULLS LAST, s.created_at DESC
       LIMIT 50`,
      [org.id],
    );

    // Include caller's membership role so the frontend can show management controls
    let caller_role: string = 'none';
    if (callerId) {
      const memberResult = await pool.query(
        `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
        [org.id, callerId],
      );
      caller_role = memberResult.rows[0]?.role ?? 'none';
    }

    // Aggregate channel stats across all sessions.
    // Each metric is its own scan: joining participants and questions together
    // multiplies the rows, which inflated total_echoes by the participant count
    // and made the cost grow quadratically with channel size.
    const statsResult = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM sessions s
           WHERE s.org_id = $1 AND s.visibility = 'public') AS total_sessions,
         (SELECT COUNT(*)::int FROM session_participants sp
            JOIN sessions s ON s.id = sp.session_id
           WHERE s.org_id = $1 AND s.visibility = 'public') AS total_participants,
         (SELECT COUNT(*)::int FROM questions q
            JOIN sessions s ON s.id = q.session_id
           WHERE s.org_id = $1 AND s.visibility = 'public'
             AND q.status != 'hidden') AS total_questions,
         (SELECT COALESCE(SUM(q.vote_count), 0)::int FROM questions q
            JOIN sessions s ON s.id = q.session_id
           WHERE s.org_id = $1 AND s.visibility = 'public'
             AND q.status != 'hidden') AS total_echoes`,
      [org.id],
    );

    // Everything below is rendered on a channel page anyone can open, so every
    // query is scoped to public sessions. The two session lists above always
    // were; these six were not, and between them they published question text
    // and session titles from private sessions, and the slug of unlisted ones —
    // which for an unlisted session is the whole of its access control.
    // Top 5 contributors: registered users with most-echoed questions in this channel.
    // Anonymous posts are excluded entirely — counting them toward a named total
    // leaks authorship by arithmetic in a small channel.
    const contributorsResult = await pool.query(
      `SELECT
         u.id AS user_id,
         u.username,
         COUNT(DISTINCT q.id)::int           AS question_count,
         COALESCE(SUM(q.vote_count), 0)::int AS total_echoes
       FROM questions q
       JOIN sessions s ON s.id = q.session_id
       JOIN users u ON u.id = q.author_id
       WHERE s.org_id = $1 AND s.visibility = 'public' AND q.status != 'hidden'
         AND q.author_id IS NOT NULL AND NOT q.post_anonymously
       GROUP BY u.id, u.username
       ORDER BY total_echoes DESC, question_count DESC
       LIMIT 5`,
      [org.id],
    );

    // Top 3 question highlights: highest-voted questions from closed sessions
    const highlightsResult = await pool.query(
      `SELECT
         q.id, q.body AS text, q.vote_count, (q.status = 'answered') AS is_answered,
         s.title AS session_title, s.slug AS session_slug,
         CASE
           WHEN q.post_anonymously THEN 'Anon' || q.anon_number
           ELSE COALESCE(u.username, 'Anonymous')
         END AS author_username
       FROM questions q
       JOIN sessions s ON s.id = q.session_id
       LEFT JOIN users u ON u.id = q.author_id AND NOT q.post_anonymously
       WHERE s.org_id = $1
         AND s.visibility = 'public'
         AND q.status != 'hidden'
         AND q.vote_count > 0
         AND s.status = 'closed'
       ORDER BY q.vote_count DESC
       LIMIT 3`,
      [org.id],
    );

    res.json({
      org: { ...org, caller_role },
      sessions: sessionsResult.rows,
      past_sessions: pastSessionsResult.rows,
      stats: statsResult.rows[0] ?? { total_sessions: 0, total_participants: 0, total_questions: 0, total_echoes: 0 },
      top_contributors: contributorsResult.rows,
      question_highlights: highlightsResult.rows,
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/orgs/:id — update org details (owner or admin) */
export async function updateOrg(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireOrgOwnerOrAdmin(id, req.user!.userId);

    const data = UpdateOrgSchema.parse(req.body);
    const fields = Object.keys(data).filter(k => (data as any)[k] !== undefined);
    if (!fields.length) { res.json({ message: 'No changes' }); return; }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map(f => (data as any)[f]);

    const result = await pool.query(
      `UPDATE organizations SET ${setClauses} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/** GET /api/orgs/:id/members — list members (owner or admin only) */
export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireOrgOwnerOrAdmin(id, req.user!.userId);

    const result = await pool.query(
      `SELECT om.id, om.user_id, om.role, om.joined_at, u.username
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.org_id = $1
       ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, om.joined_at`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/** POST /api/orgs/:id/members — add a member (owner or admin) */
export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    await requireOrgOwnerOrAdmin(id, req.user!.userId);

    const { user_id, role } = AddMemberSchema.parse(req.body);

    // Only owners can promote to owner or admin
    if (role === 'owner' || role === 'admin') {
      await requireOrgOwner(id, req.user!.userId);
    }

    // Block any operation targeting the current owner unless caller is also an owner.
    // Prevents admins from demoting/removing the owner (irreversible channel takeover).
    const targetMembership = await pool.query(
      `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
      [id, user_id],
    );
    if (targetMembership.rows[0]?.role === 'owner') {
      await requireOrgOwner(id, req.user!.userId);
    }

    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND is_guest = false AND deleted_at IS NULL',
      [user_id]);
    if (!userCheck.rows[0]) throw new AppError(404, 'User not found');

    const result = await pool.query(
      `INSERT INTO organization_members (org_id, user_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [id, user_id, role],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') next(new AppError(409, 'User is already a member'));
    else next(err);
  }
}

/** POST /api/orgs/:id/follow — follow an org (registered users only) */
export async function followOrg(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await pool.query('SELECT id FROM organizations WHERE id = $1', [req.params.id]);
    if (!org.rows[0]) throw new AppError(404, 'Channel not found');
    await pool.query(
      `INSERT INTO org_followers (org_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.user!.userId],
    );
    res.json({ following: true });
  } catch (err) { next(err); }
}

/** DELETE /api/orgs/:id/follow — unfollow an org */
export async function unfollowOrg(req: Request, res: Response, next: NextFunction) {
  try {
    await pool.query(
      `DELETE FROM org_followers WHERE org_id = $1 AND user_id = $2`,
      [req.params.id, req.user!.userId],
    );
    res.json({ following: false });
  } catch (err) { next(err); }
}

/** GET /api/orgs/mine — orgs where the caller is owner or admin */
export async function listMyOrgs(req: Request, res: Response, next: NextFunction) {
  try {
    const callerId = req.user!.userId;
    const result = await pool.query(
      `SELECT o.id, o.name, o.slug, o.avatar_url, om.role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id AND om.user_id = $1
       WHERE om.role IN ('owner','admin')
       ORDER BY o.name`,
      [callerId],
    );
    res.json({ orgs: result.rows });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/orgs/:id/members/:userId — remove a member (owner only) */
export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, userId: targetId } = req.params;
    await requireOrgOwner(id, req.user!.userId);

    if (targetId === req.user!.userId) throw new AppError(400, 'Cannot remove yourself as owner');

    const result = await pool.query(
      `DELETE FROM organization_members WHERE org_id = $1 AND user_id = $2 RETURNING id`,
      [id, targetId],
    );
    if (!result.rows[0]) throw new AppError(404, 'Member not found');
    res.json({ removed: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/orgs/search — public channel discovery */
export async function searchOrgs(req: Request, res: Response, next: NextFunction) {
  try {
    const q        = typeof req.query.q        === 'string' ? req.query.q.slice(0, 100)        : null;
    const city     = typeof req.query.city     === 'string' ? req.query.city.slice(0, 100)     : null;
    const category = typeof req.query.category === 'string' ? req.query.category.slice(0, 50)  : null;
    const lat      = req.query.lat  ? parseFloat(req.query.lat  as string) : null;
    const lng      = req.query.lng  ? parseFloat(req.query.lng  as string) : null;
    const radiusKm = parseFloat(req.query.radius_km as string) || 100;

    let rows;

    if (lat !== null && lng !== null) {
      rows = await pool.query(
        `SELECT o.id, o.name, o.slug, o.description, o.avatar_url,
                o.city, o.region, o.country, o.categories, o.is_online,
                COUNT(DISTINCT om.user_id)::int AS member_count,
                CASE WHEN o.is_online THEN NULL
                     ELSE earth_distance(ll_to_earth($1, $2), ll_to_earth(o.lat, o.lng)) / 1000
                END AS distance_km
         FROM organizations o
         LEFT JOIN organization_members om ON om.org_id = o.id
         WHERE (
           o.is_online = true
           OR (o.lat IS NOT NULL AND o.lng IS NOT NULL
               AND earth_distance(ll_to_earth($1, $2), ll_to_earth(o.lat, o.lng)) / 1000 <= $3)
         )
           AND ($4::TEXT IS NULL OR o.name ILIKE '%' || $4 || '%')
           AND ($5::TEXT IS NULL OR $5 = ANY(o.categories))
         GROUP BY o.id
         ORDER BY o.is_online ASC, distance_km ASC NULLS LAST, o.name ASC
         LIMIT 24`,
        [lat, lng, radiusKm, q, category],
      );
    } else {
      rows = await pool.query(
        `SELECT o.id, o.name, o.slug, o.description, o.avatar_url,
                o.city, o.region, o.country, o.categories, o.is_online,
                COUNT(DISTINCT om.user_id)::int AS member_count
         FROM organizations o
         LEFT JOIN organization_members om ON om.org_id = o.id
         WHERE ($1::TEXT IS NULL OR o.name ILIKE '%' || $1 || '%')
           AND ($2::TEXT IS NULL OR $2 = ANY(o.categories))
           AND ($3::TEXT IS NULL OR o.city ILIKE '%' || $3 || '%' OR o.is_online = true)
         GROUP BY o.id
         ORDER BY o.name ASC
         LIMIT 24`,
        [q, category, city],
      );
    }

    res.json({ orgs: rows.rows });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/orgs/:id — permanently delete a channel (owner only) */
export async function deleteOrg(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const orgResult = await pool.query('SELECT id FROM organizations WHERE id = $1', [id]);
    if (!orgResult.rows[0]) throw new AppError(404, 'Channel not found');
    await requireOrgOwner(id, req.user!.userId);
    // Cascades to org_members, org_followers; sessions get org_id = NULL
    await pool.query('DELETE FROM organizations WHERE id = $1', [id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}
