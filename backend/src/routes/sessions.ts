import { Router } from 'express';
import {
  createSession,
  getSession,
  getSessionByCode,
  updateSession,
  goLive,
  closeSession,
  reopenSession,
  joinSession,
  heartbeat,
  deleteSession,
  listSessions,
  listMySessions,
  listAttendedSessions,
  exportSession,
  reportSession,
} from '../controllers/sessionController';
import { muteParticipant, removeParticipant } from '../controllers/moderatorController';
import { requireAuth, requireRegistered, optionalAuth } from '../middleware/auth';
import moderatorRoutes from './moderators';
import sseRoutes from './sse';

const router = Router();

// GET  /api/sessions              — list public sessions
router.get('/', listSessions);

// POST /api/sessions              — create (registered users only)
router.post('/', requireRegistered, createSession);

// GET  /api/sessions/mine          — caller's hosted sessions (must be before /:slug)
router.get('/mine', requireAuth, listMySessions);

// GET  /api/sessions/attended      — sessions caller attended as a participant (must be before /:slug)
router.get('/attended', requireAuth, listAttendedSessions);

// GET  /api/sessions/code/:code   — look up by join code (must be before :slug to avoid clash)
router.get('/code/:code', optionalAuth, getSessionByCode);

// GET  /api/sessions/:slug        — get session by slug
router.get('/:slug', optionalAuth, getSession);

// PATCH /api/sessions/:id         — edit (host only)
router.patch('/:id', requireAuth, updateSession);

// POST /api/sessions/:id/go-live  — go live (host only)
router.post('/:id/go-live', requireRegistered, goLive);

// POST /api/sessions/:id/close    — close (host only)
router.post('/:id/close', requireRegistered, closeSession);

// POST /api/sessions/:id/reopen   — reopen a closed session (host only)
router.post('/:id/reopen', requireRegistered, reopenSession);

// DELETE /api/sessions/:id        — permanently delete (host only)
router.delete('/:id', requireRegistered, deleteSession);

// GET  /api/sessions/:id/export   — download Q&A as CSV (host only)
router.get('/:id/export', requireRegistered, exportSession);

// POST /api/sessions/:id/report   — report session to admins (any authenticated user)
router.post('/:id/report', optionalAuth, reportSession);

// POST /api/sessions/:id/join      — join (guest or registered)
router.post('/:id/join', optionalAuth, joinSession);

// POST /api/sessions/:id/heartbeat — credit regen tick (guest or registered)
router.post('/:id/heartbeat', optionalAuth, heartbeat);

// PATCH /api/sessions/:id/participants/:participantId/mute  — mute/unmute (host or mod)
router.patch('/:id/participants/:participantId/mute', requireAuth, muteParticipant);

// DELETE /api/sessions/:id/participants/:participantId  — remove + ban (host or mod)
router.delete('/:id/participants/:participantId', requireAuth, removeParticipant);

// /api/sessions/:id/moderators    — moderator management (host only)
router.use('/:id/moderators', moderatorRoutes);

// GET  /api/sessions/:id/stream   — SSE live feed
router.use('/', sseRoutes);

export default router;
