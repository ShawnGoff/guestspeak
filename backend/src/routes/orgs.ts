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
router.post('/:id/follow', requireAuth, followOrg);

// DELETE /api/orgs/:id/follow
router.delete('/:id/follow', requireAuth, unfollowOrg);

export default router;
