import { pool } from './db/pool';
import { broadcast } from './sse/broadcaster';

/**
 * Runs every minute. Promotes any 'upcoming' sessions whose starts_at
 * has passed to 'live', then broadcasts session:live over SSE so
 * connected clients update without a page reload.
 */
async function autoGoLive() {
  try {
    const result = await pool.query<{ id: string }>(
      `UPDATE sessions
       SET status = 'live'
       WHERE status = 'upcoming'
         AND starts_at IS NOT NULL
         AND starts_at <= NOW()
       RETURNING id`,
    );

    for (const { id } of result.rows) {
      broadcast(id, { type: 'session:live', data: {} });
      console.log(`[scheduler] Session ${id} auto-promoted to live`);
    }
  } catch (err) {
    console.error('[scheduler] autoGoLive error:', err);
  }
}

/**
 * Network addresses are kept to enforce bans and stop credit farming, which
 * only matters while a session is running. Thirty days after one closes, the
 * address is no longer needed for either, so it goes. Guest accounts have
 * nothing else attached to the address and lose it on the same clock.
 */
async function scrubOldIps() {
  try {
    await pool.query(
      `UPDATE session_participants sp SET ip_address = NULL
         FROM sessions s
        WHERE s.id = sp.session_id AND sp.ip_address IS NOT NULL
          AND s.status = 'closed' AND s.ends_at < NOW() - INTERVAL '30 days'`,
    );
    await pool.query(
      `UPDATE session_bans b SET ip_address = NULL
         FROM sessions s
        WHERE s.id = b.session_id AND b.ip_address IS NOT NULL
          AND s.status = 'closed' AND s.ends_at < NOW() - INTERVAL '30 days'`,
    );
    await pool.query(
      `UPDATE users SET ip_address = NULL
        WHERE is_guest = true AND ip_address IS NOT NULL
          AND created_at < NOW() - INTERVAL '30 days'`,
    );
  } catch (err) {
    console.error('[scheduler] scrubOldIps error:', err);
  }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let scrubTimer: ReturnType<typeof setInterval> | null = null;

/** Stops the tick, so a shutting-down process has nothing left holding it open. */
export function stopScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (scrubTimer) clearInterval(scrubTimer);
  scrubTimer = null;
  schedulerTimer = null;
}

export function startScheduler() {
  // Run immediately on boot (catches any that went live while server was down)
  autoGoLive();
  // Then every 60 seconds
  schedulerTimer = setInterval(autoGoLive, 60_000);
  scrubOldIps();
  scrubTimer = setInterval(scrubOldIps, 6 * 3600_000);
  console.log('[scheduler] Auto-go-live scheduler started');
}
