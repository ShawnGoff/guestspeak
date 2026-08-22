import { Router } from 'express';
import {
  searchUsers,
  getUserProfile,
} from '../controllers/userController';

const router = Router();

// Neither route needs the caller's identity any more. They used to, to report
// whether you followed this person — following is a channel relationship now,
// so both endpoints return the same thing to everyone.

// Search
router.get('/search', searchUsers);

// Profile — username, join date, and their public sessions.
router.get('/:username', getUserProfile);

export default router;
