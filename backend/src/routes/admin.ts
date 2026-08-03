import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin';
import {
  adminMe,
  listFlags,
  listBans,
  createBan,
  liftBan,
  listBannedWords,
  addBannedWord,
  removeBannedWord,
  revealIdentity,
  listSessionsAdmin,
  featureSession,
} from '../controllers/adminController';

const router = Router();

// All admin routes require platform admin status
router.use(requireAdmin);

// GET /api/admin/me — confirm admin identity
router.get('/me', adminMe);

// ── Flags ────────────────────────────────────────────────────────────────────
router.get('/flags', listFlags);

// ── Platform bans ─────────────────────────────────────────────────────────────
router.get('/bans',      listBans);
router.post('/bans',     createBan);
router.delete('/bans/:id', liftBan);

// ── Banned words ──────────────────────────────────────────────────────────────
router.get('/banned-words',      listBannedWords);
router.post('/banned-words',     addBannedWord);
router.delete('/banned-words/:id', removeBannedWord);

// ── Featured sessions ─────────────────────────────────────────────────────────
router.get('/sessions',              listSessionsAdmin);
router.patch('/sessions/:id/feature', featureSession);

// ── Identity reveal ───────────────────────────────────────────────────────────
router.get('/questions/:id/identity', revealIdentity);

export default router;
