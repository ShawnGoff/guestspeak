import { Router } from 'express';
import {
  getQuestions,
  createQuestion,
  updateQuestionStatus,
  addEcho,
  flagQuestion,
  searchSimilar,
  pinQuestion,
  spotlightQuestion,
  addHostReply,
} from '../controllers/questionController';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { questionLimiter } from '../middleware/rateLimit';

const router = Router();

// GET  /api/questions?sessionId=&sort=&status=
router.get('/', optionalAuth, getQuestions);

// GET  /api/questions/similar?sessionId=&q=    — duplicate detection
router.get('/similar', optionalAuth, searchSimilar);

// POST /api/questions
router.post('/', optionalAuth, questionLimiter, createQuestion);

// PATCH /api/questions/:id/status    — host/moderator actions
router.patch('/:id/status', requireAuth, updateQuestionStatus);

// POST /api/questions/:id/echo       — add an Echo (vote)
router.post('/:id/echo', optionalAuth, addEcho);

// POST /api/questions/:id/flag
router.post('/:id/flag', optionalAuth, flagQuestion);

// PATCH /api/questions/:id/pin  — host-only pin/unpin
router.patch('/:id/pin', requireAuth, pinQuestion);

// PATCH /api/questions/:id/spotlight — host-only Now Answering spotlight (toggle)
router.patch('/:id/spotlight', requireAuth, spotlightQuestion);

// PATCH /api/questions/:id/reply — host-only post-session reply
router.patch('/:id/reply', requireAuth, addHostReply);

export default router;
