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

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** Stops the tick, so a shutting-down process has nothing left holding it open. */
export function stopScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export function startScheduler() {
  // Run immediately on boot (catches any that went live while server was down)
  autoGoLive();
  // Then every 60 seconds
  schedulerTimer = setInterval(autoGoLive, 60_000);
  console.log('[scheduler] Auto-go-live scheduler started');
}
