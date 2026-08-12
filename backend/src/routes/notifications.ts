import { Router } from 'express';
import {
  listNotifications,
  markAllRead,
  markOneRead,
  deleteNotification,
  getPushKey,
  subscribePush,
  unsubscribePush,
} from '../controllers/notificationController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All notification routes require auth
router.use(requireAuth);

// GET /api/notifications/push/key — VAPID public key (must precede /:id routes)
router.get('/push/key', getPushKey);

// POST   /api/notifications/push — register this browser
// DELETE /api/notifications/push — unregister it
router.post('/push', subscribePush);
router.delete('/push', unsubscribePush);

// GET  /api/notifications
router.get('/', listNotifications);

// PATCH /api/notifications/read — mark ALL read (must be before /:id)
router.patch('/read', markAllRead);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', markOneRead);

// DELETE /api/notifications/:id
router.delete('/:id', deleteNotification);

export default router;
