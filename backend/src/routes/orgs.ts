import { Router } from 'express';
import {
  createOrg,
  getOrg,
  updateOrg,
  deleteOrg,
  listMembers,
  addMember,
  removeMember,
  listMyOrgs,
  followOrg,
  unfollowOrg,
  searchOrgs,
} from '../controllers/orgController';
import { listPrompts, createPrompt } from '../controllers/channelFeedController';
import { requireAuth, requireRegistered, optionalAuth } from '../middleware/auth';

const router = Router();

// GET  /api/orgs/mine — orgs where caller is owner/admin (must be before /:slug)
router.get('/mine', requireAuth, listMyOrgs);

// GET  /api/orgs/search — public channel discovery (must be before /:slug)
router.get('/search', searchOrgs);

// POST /api/orgs
router.post('/', requireRegistered, createOrg);

// GET  /api/orgs/:slug  — public profile page (optionalAuth so owners see their role)
router.get('/:slug', optionalAuth, getOrg);

// PATCH /api/orgs/:id
router.patch('/:id', requireAuth, updateOrg);

// DELETE /api/orgs/:id
router.delete('/:id', requireAuth, deleteOrg);

// GET  /api/orgs/:id/members
router.get('/:id/members', requireAuth, listMembers);

// POST /api/orgs/:id/members
router.post('/:id/members', requireAuth, addMember);

// DELETE /api/orgs/:id/members/:userId
router.delete('/:id/members/:userId', requireAuth, removeMember);

// POST   /api/orgs/:id/follow
// DELETE /api/orgs/:id/follow
//
// requireRegistered, matching user follows. On requireAuth a guest could
// follow: guests hold a real users row, so the insert succeeded and the org's
// public follower count went up by one for someone who can never be notified —
// the go-live fan-out filters is_guest — and whose token disappears with their
// browser. Following is an account feature; there is nothing to follow with
// until you have one.
// Channel feed — the host asks, followers reply.
// GET   /api/orgs/:id/prompts
// POST  /api/orgs/:id/prompts
router.get('/:id/prompts',  optionalAuth,      listPrompts);
router.post('/:id/prompts', requireRegistered, createPrompt);

router.post('/:id/follow', requireRegistered, followOrg);
router.delete('/:id/follow', requireRegistered, unfollowOrg);

export default router;
