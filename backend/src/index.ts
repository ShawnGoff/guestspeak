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

// Trust Railway's proxy so express-rate-limit sees the real client IP
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
}));

app.use(express.json({ limit: '50kb' }));
app.use('/api', apiLimiter);

// Serve uploaded files — both paths for compatibility
// /api/uploads is preferred (always routed correctly through any proxy)
// /uploads kept for backwards compat with existing stored URLs
//
// These are user-supplied bytes served from our own origin, so they are pinned
// to their stored Content-Type, never sniffed, and never allowed to execute as
// a document. The upload route already restricts extensions to image types;
// this is the second layer in case an older file predates that.
const UPLOADS_STATIC = express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
});
app.use('/api/uploads', UPLOADS_STATIC);
app.use('/uploads',     UPLOADS_STATIC);

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
