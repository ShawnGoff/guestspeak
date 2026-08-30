import express, { Router } from 'express';
import authRoutes from './auth';
import sessionRoutes from './sessions';
import questionRoutes from './questions';
import orgRoutes from './orgs';
import promptRoutes from './prompts';
import discoverRoutes from './discover';
import userRoutes from './users';
import uploadRoutes from './upload';
import notificationRoutes from './notifications';
import unsubscribeRoutes from './unsubscribe';
import adminRoutes from './admin';

const router = Router();

router.use('/auth', authRoutes);
router.use('/sessions', sessionRoutes);
router.use('/questions', questionRoutes);
router.use('/orgs', orgRoutes);
router.use('/prompts', promptRoutes);
router.use('/discover', discoverRoutes);
router.use('/users', userRoutes);
router.use('/upload', uploadRoutes);
// Before the others and with its own body parser: the RFC 8058 one-click POST
// arrives form-encoded, which express.json does not read. The token is in the
// query string too, so this is belt and braces.
router.use('/unsubscribe', express.urlencoded({ extended: false, limit: '4kb' }), unsubscribeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

export default router;
