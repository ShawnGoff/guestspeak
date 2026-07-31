import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import router from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { startScheduler } from './scheduler';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '50kb' }));
app.use('/api', apiLimiter);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// All API routes
app.use('/api', router);

// Error handler must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`GuestSpeak API running on http://localhost:${PORT}`);
  startScheduler();
});

export default app;
