import { Router } from 'express';
import {
  listNotifications,
  markAllRead,
  markOneRead,
  deleteNotification,
} from '../controllers/notificationController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All notification routes require auth
router.use(requireAuth);

// GET  /api/notifications
router.get('/', listNotifications);

// PATCH /api/notifications/read — mark ALL read (must be before /:id)
router.patch('/read', markAllRead);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', markOneRead);

// DELETE /api/notifications/:id
router.delete('/:id', deleteNotification);

export default router;
