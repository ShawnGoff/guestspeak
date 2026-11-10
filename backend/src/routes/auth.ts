import { Router } from 'express';
import { verifyEmail, resendVerification, register, login, guestToken, getMe, updateMe, deleteAccount, searchUsers, checkUsername, forgotPassword, resetPassword } from '../controllers/authController';
import { loginAccountLimiter, loginLimiter, registerLimiter, guestLimiter, checkUsernameLimiter } from '../middleware/rateLimit';
import { requireAuth, requireRegistered, optionalAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
// optionalAuth so a guest upgrading to an account is identified by their own
// token; the guest identity to migrate is never read from the request body.
router.post('/register', registerLimiter, optionalAuth, register);

// POST /api/auth/login
router.post('/login', loginLimiter, loginAccountLimiter, login);

// POST /api/auth/guest  — issues a guest JWT + guest_token
// guestLimiter is permissive: conference venues have many attendees behind one IP
router.post('/guest', guestLimiter, guestToken);

// POST /api/auth/verify-email — token from the confirmation email
router.post('/verify-email', registerLimiter, verifyEmail);

// POST /api/auth/resend-verification
router.post('/resend-verification', registerLimiter, requireRegistered, resendVerification);

// GET  /api/auth/me
router.get('/me', requireRegistered, getMe);

// PATCH /api/auth/me
router.patch('/me', requireRegistered, updateMe);

// DELETE /api/auth/me — permanent account deletion (requires password)
router.delete('/me', requireRegistered, deleteAccount);

// POST /api/auth/forgot-password
router.post('/forgot-password', loginLimiter, forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', registerLimiter, resetPassword);

// GET /api/auth/check-username?username= — public, checks against registered users only
router.get('/check-username', checkUsernameLimiter, checkUsername);

// GET /api/auth/users/search?q=
router.get('/users/search', requireAuth, searchUsers);

export default router;
