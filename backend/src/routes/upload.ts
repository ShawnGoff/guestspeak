import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRegistered } from '../middleware/auth';

const router = Router();

// ─── Storage strategy ─────────────────────────────────────────────────────────
// When R2 env vars are present → upload to Cloudflare R2 (persistent, CDN-backed)
// Otherwise → local disk (fine for development, but ephemeral on Railway)

const USE_R2 = !!(
  process.env.R2_ACCOUNT_ID &&
  process.env.R2_ACCESS_KEY_ID &&
  process.env.R2_SECRET_ACCESS_KEY &&
  process.env.R2_BUCKET
);

// ─── Local disk fallback ──────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

// ─── Multer instance ──────────────────────────────────────────────────────────

const upload = multer({
  storage: USE_R2 ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    if (!ok) return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    cb(null, true);
  },
});

// ─── R2 upload helper ─────────────────────────────────────────────────────────

async function uploadToR2(file: Express.Multer.File): Promise<string> {
  // Lazy-import so S3 SDK isn't required in dev when USE_R2 is false
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const ext      = path.extname(file.originalname).toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET!,
    Key:         filename,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));

  // R2_PUBLIC_URL = your bucket's public URL, e.g. https://pub-xxx.r2.dev
  // or a custom domain like https://assets.guestspeak.app
  const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  return `${base}/${filename}`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post('/', requireRegistered, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    if (USE_R2) {
      const url = await uploadToR2(req.file);
      return res.json({ url });
    }

    // Local disk — return a path that resolveAsset() will prepend BACKEND to
    return res.json({ url: `/api/uploads/${req.file.filename}` });
  } catch (err: any) {
    console.error('[upload] failed:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
