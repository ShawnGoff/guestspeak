import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
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

/**
 * Allowed image types, and the extension we will store each one under.
 *
 * The stored extension is derived from this map — never from the uploaded
 * filename. `originalname` is fully attacker-controlled, and a file saved as
 * `.html` is served back as text/html from our own origin, which turns an
 * "image" upload into stored XSS.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

/** Magic-byte signatures, so the declared Content-Type can't lie about content. */
function sniffMimeType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function storedFilename(mimetype: string): string {
  return `${Date.now()}-${randomBytes(8).toString('hex')}${ALLOWED_TYPES[mimetype]}`;
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, storedFilename(file.mimetype)),
});

// ─── Multer instance ──────────────────────────────────────────────────────────

const upload = multer({
  storage: USE_R2 ? multer.memoryStorage() : diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in ALLOWED_TYPES)) {
      return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
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

  const filename = storedFilename(file.mimetype);

  await client.send(new PutObjectCommand({
    Bucket:             process.env.R2_BUCKET!,
    Key:                filename,
    Body:               file.buffer,
    ContentType:        file.mimetype,
    // Belt and braces: never let the CDN sniff a different type, and never let
    // a stored object render inline as a document.
    ContentDisposition: 'inline',
    CacheControl:       'public, max-age=31536000, immutable',
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
      // Memory storage — verify the bytes really are the image type claimed.
      if (sniffMimeType(req.file.buffer) !== req.file.mimetype) {
        return res.status(400).json({ error: 'File contents do not match a supported image format' });
      }
      const url = await uploadToR2(req.file);
      return res.json({ url });
    }

    // Disk storage — multer has already streamed it, so verify and clean up.
    const diskPath = path.join(UPLOADS_DIR, req.file.filename);
    const head = await fs.promises.open(diskPath, 'r').then(async fh => {
      try {
        const buf = Buffer.alloc(12);
        const { bytesRead } = await fh.read(buf, 0, 12, 0);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    });

    if (sniffMimeType(head) !== req.file.mimetype) {
      await fs.promises.unlink(diskPath).catch(() => {});
      return res.status(400).json({ error: 'File contents do not match a supported image format' });
    }

    // Local disk — return a path that resolveAsset() will prepend BACKEND to
    return res.json({ url: `/api/uploads/${req.file.filename}` });
  } catch (err: any) {
    console.error('[upload] failed:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
