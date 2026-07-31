import { Router } from 'express';
import { requireRegistered, optionalAuth } from '../middleware/auth';
import {
  searchUsers,
  getUserProfile,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from '../controllers/userController';

const router = Router();

// Search — optionalAuth so is_following is accurate for logged-in users
router.get('/search', optionalAuth, searchUsers);

// Profile
router.get('/:username',           optionalAuth,      getUserProfile);
router.get('/:username/followers', optionalAuth,      getFollowers);
router.get('/:username/following', optionalAuth,      getFollowing);

// Follow / unfollow — registered users only
router.post('/:username/follow',   requireRegistered, followUser);
router.delete('/:username/follow', requireRegistered, unfollowUser);

export default router;
