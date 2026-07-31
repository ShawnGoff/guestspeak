import { Router } from 'express';
import authRoutes from './auth';
import sessionRoutes from './sessions';
import questionRoutes from './questions';
import orgRoutes from './orgs';
import discoverRoutes from './discover';
import userRoutes from './users';
import uploadRoutes from './upload';
import notificationRoutes from './notifications';

const router = Router();

router.use('/auth', authRoutes);
router.use('/sessions', sessionRoutes);
router.use('/questions', questionRoutes);
router.use('/orgs', orgRoutes);
router.use('/discover', discoverRoutes);
router.use('/users', userRoutes);
router.use('/upload', uploadRoutes);
router.use('/notifications', notificationRoutes);

export default router;
