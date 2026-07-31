import { Router } from 'express';
import { register, login, guestToken, getMe, updateMe, searchUsers, checkUsername, forgotPassword, resetPassword } from '../controllers/authController';
import { authLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', authLimiter, register);

// POST /api/auth/login
router.post('/login', authLimiter, login);

// POST /api/auth/guest  — issues a guest JWT + guest_token
router.post('/guest', authLimiter, guestToken);

// GET  /api/auth/me
router.get('/me', requireAuth, getMe);

// PATCH /api/auth/me
router.patch('/me', requireAuth, updateMe);

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, resetPassword);

// GET /api/auth/check-username?username= — public, checks against registered users only
router.get('/check-username', authLimiter, checkUsername);

// GET /api/auth/users/search?q=
router.get('/users/search', requireAuth, searchUsers);

export default router;
