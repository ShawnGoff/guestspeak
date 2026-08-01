import { Router } from 'express';
import {
  listModerators,
  addModerator,
  updateModeratorPermissions,
  removeModerator,
  muteParticipant,
  removeParticipant,
} from '../controllers/moderatorController';
import { requireAuth } from '../middleware/auth';

const router = Router({ mergeParams: true }); // inherit :id from parent

// All moderator routes require a logged-in host
router.use(requireAuth);

// GET  /api/sessions/:id/moderators
router.get('/', listModerators);

// POST /api/sessions/:id/moderators
router.post('/', addModerator);

// PATCH /api/sessions/:id/moderators/:userId
router.patch('/:userId', updateModeratorPermissions);

// DELETE /api/sessions/:id/moderators/:userId
router.delete('/:userId', removeModerator);

// PATCH /api/sessions/:id/participants/:participantId/mute
router.patch('/participants/:participantId/mute', muteParticipant);

// DELETE /api/sessions/:id/participants/:participantId
router.delete('/participants/:participantId', removeParticipant);

export default router;
