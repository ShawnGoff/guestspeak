import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { optionalAuth } from '../middleware/auth';

const router = Router();

/**
 * GET /api/discover
 *
 * Query params:
 *   lat, lng    — user's coordinates (optional)
 *   radius_km   — search radius in km, default 50
 *   city        — fallback city filter when no coords provided
 *
 * Returns:
 *   live_now  — public sessions currently live, ordered by participant count
 *   featured  — manually featured/sponsored sessions
 *   nearby    — public sessions in the area (upcoming or live), ordered by distance/recency
 */
router.get('/', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : null;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : null;
    const radiusKm = parseFloat(req.query.radius_km as string) || 50;
    const city = typeof req.query.city === 'string'
      ? req.query.city.slice(0, 100)
      : undefined;

    const SESSION_FIELDS = `
      s.id, s.title, s.slug, s.description, s.status, s.is_featured,
      s.city, s.region, s.country, s.starts_at,
      s.org_id, o.name as org_name, o.slug as org_slug, o.is_verified as org_is_verified, o.avatar_url as org_avatar_url,
      u.username as host_username
    `;

    // ── Featured ──────────────────────────────────────────────────────────
    const featuredResult = await pool.query(
      `SELECT ${SESSION_FIELDS}
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       LEFT JOIN organizations o ON o.id = s.org_id
       WHERE s.visibility = 'public' AND s.is_featured = TRUE AND s.status IN ('upcoming', 'live')
       ORDER BY s.starts_at ASC NULLS LAST
       LIMIT 6`,
    );

    // ── Live Now ──────────────────────────────────────────────────────────
    const liveResult = await pool.query(
      `SELECT ${SESSION_FIELDS},
              COUNT(DISTINCT sp.id) as participant_count
       FROM sessions s
       JOIN users u ON u.id = s.host_id
       LEFT JOIN organizations o ON o.id = s.org_id
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       WHERE s.visibility = 'public' AND s.status = 'live'
       GROUP BY s.id, o.name, o.slug, o.is_verified, o.avatar_url, u.username
       ORDER BY participant_count DESC, s.starts_at DESC
       LIMIT 20`,
    );

    // ── Nearby / Public ───────────────────────────────────────────────────
    let nearbyResult;

    if (lat !== null && lng !== null) {
      nearbyResult = await pool.query(
        `SELECT ${SESSION_FIELDS},
                s.lat, s.lng,
                earth_distance(
                  ll_to_earth($1, $2),
                  ll_to_earth(s.lat, s.lng)
                ) / 1000 AS distance_km
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id
         WHERE s.visibility = 'public'
           AND s.status IN ('upcoming', 'live')
           AND s.lat IS NOT NULL AND s.lng IS NOT NULL
           AND earth_distance(
                 ll_to_earth($1, $2),
                 ll_to_earth(s.lat, s.lng)
               ) / 1000 <= $3
         ORDER BY distance_km ASC, s.starts_at ASC NULLS LAST
         LIMIT 20`,
        [lat, lng, radiusKm],
      );
    } else if (city) {
      const cityRows = await pool.query(
        `SELECT ${SESSION_FIELDS}
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id
         WHERE s.visibility = 'public'
           AND s.status IN ('upcoming', 'live')
           AND s.city ILIKE $1
         ORDER BY s.starts_at ASC NULLS LAST, s.created_at DESC
         LIMIT 20`,
        [`%${city}%`],
      );
      if (cityRows.rows.length > 0) {
        nearbyResult = cityRows;
      } else {
        // Fallback: all public sessions globally
        nearbyResult = await pool.query(
          `SELECT ${SESSION_FIELDS}
           FROM sessions s
           JOIN users u ON u.id = s.host_id
           LEFT JOIN organizations o ON o.id = s.org_id
           WHERE s.visibility = 'public' AND s.status IN ('upcoming', 'live')
           ORDER BY s.starts_at ASC NULLS LAST
           LIMIT 20`,
        );
      }
    } else {
      nearbyResult = await pool.query(
        `SELECT ${SESSION_FIELDS}
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id
         WHERE s.visibility = 'public' AND s.status IN ('upcoming', 'live')
         ORDER BY s.starts_at ASC NULLS LAST
         LIMIT 20`,
      );
    }

    // ── Following ─────────────────────────────────────────────────────────
    let followingRows: any[] = [];
    const callerId = req.user?.userId;
    if (callerId && !req.user?.isGuest) {
      const followingResult = await pool.query(
        `SELECT ${SESSION_FIELDS}
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id
         WHERE s.visibility IN ('public', 'unlisted')
           AND s.status IN ('upcoming', 'live')
           AND s.host_id IN (
             SELECT following_id FROM user_follows WHERE follower_id = $1
           )
         ORDER BY s.status = 'live' DESC, s.starts_at ASC NULLS LAST
         LIMIT 20`,
        [callerId],
      );
      followingRows = followingResult.rows;
    }

    res.json({
      live_now: liveResult.rows,
      featured: featuredResult.rows,
      nearby: nearbyResult.rows,
      following: followingRows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
