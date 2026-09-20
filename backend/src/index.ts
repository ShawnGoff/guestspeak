import 'dotenv/config';

// Before any other import: the SDK instruments modules as they load.
import { initSentry } from './lib/sentry';
initSentry();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import router from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { startScheduler, stopScheduler } from './scheduler';
import { closeAllClients } from './sse/broadcaster';
import { closeBus } from './sse/bus';
import { pool } from './db/pool';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's proxy so express-rate-limit sees the real client IP
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  // `||` not `??`. Clearing this field in a dashboard stores an empty
  // string, which `??` keeps — and an empty CORS origin matches nothing, so
  // every browser request to this API is refused. The whole product is down,
  // with the API itself healthy and nothing in its logs.
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
}));

app.use(express.json({ limit: '50kb' }));
app.use('/api', apiLimiter);

// Serve uploaded files — both paths for compatibility
// /api/uploads is preferred (always routed correctly through any proxy)
// /uploads kept for backwards compat with existing stored URLs
//
// These are user-supplied bytes served from our own origin, so they are pinned
// to their stored Content-Type, never sniffed, and never allowed to execute as
// a document. The upload route already restricts extensions to image types;
// this is the second layer in case an older file predates that.
const UPLOADS_STATIC = express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
});
app.use('/api/uploads', UPLOADS_STATIC);
app.use('/uploads',     UPLOADS_STATIC);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// All API routes
app.use('/api', router);

// Unmatched API routes answer in JSON rather than Express's default HTML page.
app.use('/api', notFoundHandler);

// Error handler must be last
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`GuestSpeak API running on http://localhost:${PORT}`);
  startScheduler();
});

/**
 * Shut down on purpose rather than being killed mid-sentence.
 *
 * Railway sends SIGTERM on every deploy and waits a short grace period before
 * SIGKILL. With nothing listening, that grace period was spent serving traffic
 * that was then cut off: requests died mid-response, and every SSE stream
 * dropped without a close frame, so every phone in a live session sat in
 * silence until EventSource's own timeout noticed.
 *
 * Order matters. Stop accepting new connections first, so nothing arrives that
 * we are about to refuse. Close the streams next, with an event that tells the
 * browser to reconnect now rather than wait. Then the scheduler, the bus and
 * the pool, which are what keep the process alive once the sockets are gone.
 *
 * The timeout is the backstop: if an in-flight request hangs, exiting late is
 * worse than exiting rudely, because the platform will SIGKILL us anyway and a
 * clean exit code is how a deploy is recorded as healthy.
 */
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string) {
  // Railway can send SIGTERM more than once, and a second pass while the first
  // is still closing would double-close the pool and throw on the way out.
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, closing down`);

  const forced = setTimeout(() => {
    console.error('[shutdown] still busy after grace period, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  // Do not let the backstop itself hold the process open once we are done.
  forced.unref();

  server.close(() => console.log('[shutdown] http server closed'));

  const streams = closeAllClients();
  if (streams) console.log(`[shutdown] closed ${streams} SSE stream(s)`);

  stopScheduler();
  await closeBus().catch(err => console.error('[shutdown] bus:', err?.message ?? err));
  await pool.end().catch(err => console.error('[shutdown] pool:', err?.message ?? err));

  clearTimeout(forced);
  console.log('[shutdown] done');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

export default app;
