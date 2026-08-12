import { Router, Request, Response, NextFunction } from 'express';
import { addClient, removeClient, clientCount } from '../sse/broadcaster';
import { optionalAuthSSE } from '../middleware/auth';
import { resolveCallerRole } from '../db/permissions';
import { feedModeFor } from '../lib/feedPolicy';
import { envIntMin } from '../lib/env';
import { pool } from '../db/pool';

const ELEVATED_ROLES: readonly string[] = ['host', 'org_owner', 'org_admin', 'moderator'];

const router = Router();

/**
 * GET /api/sessions/:id/stream
 *
 * Server-Sent Events endpoint. The client connects once and receives
 * push events for the duration of the session.
 *
 * Event types:
 *   question:new      — a question was submitted
 *   question:updated  — status changed (starred, answered, hidden)
 *   echo:added        — vote_count incremented on a question
 *   session:live      — session went live
 *   session:closed    — host closed the session
 *
 * Auth: token accepted in query string (?token=...) because EventSource
 * does not support custom request headers.
 */
router.get('/:id/stream', optionalAuthSSE, async (req: Request, res: Response, next: NextFunction) => {
  // Express 4 does not catch async throws: without this wrapper a transient DB
  // error here becomes an unhandled rejection and takes the process down.
  try {
    const { id } = req.params;

    // Verify session exists
    const result = await pool.query(
      `SELECT s.status, s.visibility, s.host_id,
              (SELECT COUNT(*)::int FROM session_participants sp
                WHERE sp.session_id = s.id) AS participant_count
       FROM sessions s WHERE s.id = $1`,
      [id],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const { status, visibility, participant_count } = result.rows[0];

    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    const role = callerId ? (await resolveCallerRole(id, callerId)).role : 'none';
    const elevated = ELEVATED_ROLES.includes(role);

    // Block private session streams for anyone without elevated access
    if (visibility === 'private' && !elevated) {
      res.status(403).json({ error: 'This session is private' });
      return;
    }

    if (status === 'closed') {
      res.status(410).json({ error: 'Session is closed' });
      return;
    }

    // Enforce the same threshold getSession advertises. Without this the server
    // tells a large session's audience to poll but still accepts them if they
    // stream anyway — a stale cached bundle, or anything not using our client,
    // would reopen exactly the fan-out the threshold exists to prevent.
    // Elevated callers are exempt: only ever a handful, and they need immediacy.
    const SSE_CAP = envIntMin('SSE_MAX_CLIENTS_PER_SESSION', 500, 1);
    const tooLarge = feedModeFor(participant_count, elevated) === 'polling';

    if (!elevated && (tooLarge || clientCount(id) >= SSE_CAP)) {
      // 409 rather than 503: this is not transient, and retrying will not help.
      // The client should fall back to polling the cached feed instead.
      res.status(409).json({
        error: 'This session is too large for a live stream. Falling back to periodic updates.',
        feed_mode: 'polling',
      });
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
    res.flushHeaders();

    // Send a heartbeat every 30s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    addClient(id, res, callerId ?? undefined, req.user?.guestToken, elevated);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeClient(id, res);
    });
  } catch (err) {
    next(err);
  }
});

export default router;
