import { Router, Request, Response } from 'express';
import { addClient, removeClient, clientCount } from '../sse/broadcaster';
import { optionalAuthSSE } from '../middleware/auth';
import { pool } from '../db/pool';

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
router.get('/:id/stream', optionalAuthSSE, async (req: Request, res: Response) => {
  const { id } = req.params;

  // Verify session exists
  const result = await pool.query(
    'SELECT status, visibility, host_id FROM sessions WHERE id = $1',
    [id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { status, visibility, host_id } = result.rows[0];

  // Block private session streams for non-hosts
  if (visibility === 'private') {
    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    if (callerId !== host_id) {
      res.status(403).json({ error: 'This session is private' });
      return;
    }
  }

  if (status === 'closed') {
    res.status(410).json({ error: 'Session is closed' });
    return;
  }

  // Enforce per-session connection cap to prevent DoS
  const SSE_CAP = parseInt(process.env.SSE_MAX_CLIENTS_PER_SESSION ?? '500', 10);
  if (clientCount(id) >= SSE_CAP) {
    res.status(503).json({ error: 'Session is at capacity. Please try again shortly.' });
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

  const userId = req.user?.isGuest === false ? req.user.userId : undefined;
  const guestToken = req.user?.guestToken;
  addClient(id, res, userId, guestToken);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(id, res);
  });
});

export default router;
