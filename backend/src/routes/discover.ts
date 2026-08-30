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

    /**
     * How far ahead the Upcoming list reaches.
     *
     * A conference puts its whole programme up at once, so "everything
     * upcoming" is a week of sessions on a page someone opened to find what is
     * on this afternoon. Anything unrecognised falls through to 'all', which is
     * the behaviour before this existed.
     */
    const WINDOWS: Record<string, string | null> = {
      hour:  "s.starts_at <= NOW() + INTERVAL '1 hour'",
      today: "s.starts_at <  date_trunc('day', NOW()) + INTERVAL '1 day'",
      week:  "s.starts_at <= NOW() + INTERVAL '7 days'",
      all:   null,
    };
    const windowKey = typeof req.query.window === 'string' ? req.query.window : 'all';
    const windowClause = WINDOWS[windowKey] ?? null;

    /**
     * Ordering for the upcoming list. 'soon' is the default because a session
     * with no audience yet is the normal state of an upcoming one — sorting
     * those by popularity ranks noise.
     */
    const ORDERS: Record<string, string> = {
      soon:    's.starts_at ASC NULLS LAST',
      popular: 'participant_count DESC, s.starts_at ASC NULLS LAST',
      new:     's.created_at DESC',
    };
    const sortKey = typeof req.query.sort === 'string' ? req.query.sort : 'soon';
    const upcomingOrder = ORDERS[sortKey] ?? ORDERS.soon;
    // Popularity needs the count, which the nearby queries do not select today.
    const needsCount = sortKey === 'popular';

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
    //
    // Upcoming only. This used to take `status IN ('upcoming','live')`, which
    // is every session live_now had already returned — so with ten shows on
    // air the page carried twenty-six links to seventeen sessions, each live
    // one printed twice.
    //
    // Worse than the repetition: the client titles this section "Upcoming"
    // whenever the visitor has not granted location, which is every first
    // visit. So a show that was on air right then was filed under "Upcoming".
    //
    // A live session near you is still reachable — live_now is not filtered by
    // distance, so it is above this section already.
    let nearbyResult;

    // Shared by all four variants below. The participant count is joined in so
    // the popularity sort has something to order by and the client can show it
    // — Live Now already carried it and Upcoming did not.
    const COUNTED = `
         LEFT JOIN session_participants sp ON sp.session_id = s.id`;
    const GROUPED = `
         GROUP BY s.id, o.name, o.slug, o.is_verified, o.avatar_url, u.username`;
    const COUNT_FIELD = `, COUNT(DISTINCT sp.id) AS participant_count`;
    const windowSql = windowClause ? `AND ${windowClause}` : '';

    /**
     * Distance stays the default ordering when we know where the viewer is —
     * that is the whole point of the section — but an explicit sort wins,
     * because someone who picked "most popular" meant it.
     */
    const orderFor = (isGeo: boolean) =>
      sortKey !== 'soon' ? upcomingOrder
        : isGeo ? 'distance_km ASC, s.starts_at ASC NULLS LAST'
        : 's.starts_at ASC NULLS LAST';

    if (lat !== null && lng !== null) {
      nearbyResult = await pool.query(
        `SELECT ${SESSION_FIELDS}${COUNT_FIELD},
                s.lat, s.lng,
                earth_distance(
                  ll_to_earth($1, $2),
                  ll_to_earth(s.lat, s.lng)
                ) / 1000 AS distance_km
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id${COUNTED}
         WHERE s.visibility = 'public'
           AND s.status = 'upcoming'
           ${windowSql}
           AND s.lat IS NOT NULL AND s.lng IS NOT NULL
           AND earth_distance(
                 ll_to_earth($1, $2),
                 ll_to_earth(s.lat, s.lng)
               ) / 1000 <= $3
         ${GROUPED}, s.lat, s.lng
         ORDER BY ${orderFor(true)}
         LIMIT 20`,
        [lat, lng, radiusKm],
      );
    } else if (city) {
      const cityRows = await pool.query(
        `SELECT ${SESSION_FIELDS}${COUNT_FIELD}
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id${COUNTED}
         WHERE s.visibility = 'public'
           AND s.status = 'upcoming'
           ${windowSql}
           AND s.city ILIKE $1
         ${GROUPED}
         ORDER BY ${orderFor(false)}
         LIMIT 20`,
        [`%${city}%`],
      );
      if (cityRows.rows.length > 0) {
        nearbyResult = cityRows;
      } else {
        // Fallback: all public sessions globally
        nearbyResult = await pool.query(
          `SELECT ${SESSION_FIELDS}${COUNT_FIELD}
           FROM sessions s
           JOIN users u ON u.id = s.host_id
           LEFT JOIN organizations o ON o.id = s.org_id${COUNTED}
           WHERE s.visibility = 'public' AND s.status = 'upcoming'
             ${windowSql}
           ${GROUPED}
           ORDER BY ${orderFor(false)}
           LIMIT 20`,
        );
      }
    } else {
      nearbyResult = await pool.query(
        `SELECT ${SESSION_FIELDS}${COUNT_FIELD}
         FROM sessions s
         JOIN users u ON u.id = s.host_id
         LEFT JOIN organizations o ON o.id = s.org_id${COUNTED}
         WHERE s.visibility = 'public' AND s.status = 'upcoming'
           ${windowSql}
         ${GROUPED}
         ORDER BY ${orderFor(false)}
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
         -- Public only, like every other feed here. Following a host is not
         -- an invitation to their unlisted sessions: unlisted means reachable
         -- by link, and putting one in a feed is the listing it exists to
         -- avoid — with the slug attached, which is its whole access control.
         WHERE s.visibility = 'public'
           AND s.status IN ('upcoming', 'live')
           AND s.org_id IN (
             SELECT org_id FROM org_followers WHERE user_id = $1
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
