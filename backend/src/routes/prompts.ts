import { Router } from 'express';
import {
  closePrompt,
  createReply,
  listReplies,
  hideReply,
} from '../controllers/channelFeedController';
import { requireRegistered, optionalAuth } from '../middleware/auth';
import { channelReplyLimiter } from '../middleware/rateLimit';

const router = Router();

// Creating and listing prompts lives under the channel they belong to
// (/api/orgs/:id/prompts). Everything here acts on one existing prompt.

// PATCH /api/prompts/:promptId/close — toggle whether it takes replies
router.patch('/:promptId/close', requireRegistered, closePrompt);

// GET  /api/prompts/:promptId/replies — public; the channel page is public
router.get('/:promptId/replies', optionalAuth, listReplies);

// POST /api/prompts/:promptId/replies — registered accounts only. Not
// "must be following": a follow is one click and reversible, so the account is
// the real bar. Rate-limited because replies are free and nothing else slows
// them down.
router.post('/:promptId/replies', requireRegistered, channelReplyLimiter, createReply);

// PATCH /api/prompts/:promptId/replies/:replyId/hide — channel staff only.
// Replies are free, so there is no credit economy slowing anyone down and this
// is the only brake there is.
router.patch('/:promptId/replies/:replyId/hide', requireRegistered, hideReply);

export default router;
