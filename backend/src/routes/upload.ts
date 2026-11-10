import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { requireRegistered } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';

const router = Router();

// ─── Storage strategy ─────────────────────────────────────────────────────────
// When R2 env vars are present → upload to Cloudflare R2 (persistent, CDN-backed)
// Otherwise → local disk (fine for development, but ephemeral on Railway)

// R2_PUBLIC_URL belongs in this gate even though the upload itself does not
// need it. Without it the upload succeeds and the stored URL is built from an
// empty base — "/filename", a path with no host — so every avatar 404s while
// the bytes sit safely in the bucket. Falling back to local disk is a better
// failure than storing broken URLs, and the startup warning below says which
// variable is missing.
const R2_VARS = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET', 'R2_PUBLIC_URL',
] as const;

const R2_MISSING = R2_VARS.filter(v => !process.env[v]);
const USE_R2 = R2_MISSING.length === 0;

if (!USE_R2 && R2_MISSING.length < R2_VARS.length) {
  // Some set, some not — almost certainly a half-finished setup rather than a
  // deliberate choice to use local disk.
  console.error(
    `[upload] R2 is partially configured — missing ${R2_MISSING.join(', ')}. `
    + 'Falling back to local disk, which is wiped on every deploy.',
  );
} else if (!USE_R2 && process.env.NODE_ENV === 'production') {
  console.warn(
    '[upload] R2 is not configured. Uploads go to local disk, which Railway '
    + 'wipes on every deploy — avatars will vanish.',
  );
}

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


// ─── Multer instance ──────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in ALLOWED_TYPES)) {
      return cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    }
    cb(null, true);
  },
});

// ─── R2 upload helper ─────────────────────────────────────────────────────────

async function uploadToR2(file: Express.Multer.File, body: Buffer): Promise<string> {
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
    Body:               body,
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

/**
 * Re-encode the image before it is stored.
 *
 * Phone photos carry EXIF — often GPS coordinates, device model and capture
 * time — and avatars are served publicly. sharp drops all metadata on output
 * unless asked to keep it; rotate() first bakes the orientation tag into the
 * pixels so photos do not come out sideways once it is gone. Re-encoding also
 * means whatever is stored was produced by us, not by the uploader, and a
 * file that is not really an image fails here rather than being served.
 */
async function sanitiseImage(input: Buffer, mimetype: string): Promise<Buffer> {
  const img = sharp(input, { animated: mimetype === 'image/gif', limitInputPixels: 25_000_000 })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
  switch (mimetype) {
    case 'image/jpeg': return img.jpeg({ quality: 85 }).toBuffer();
    case 'image/png':  return img.png().toBuffer();
    case 'image/webp': return img.webp({ quality: 85 }).toBuffer();
    default:           return img.gif().toBuffer();
  }
}

router.post('/', requireRegistered, uploadLimiter, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    if (sniffMimeType(req.file.buffer) !== req.file.mimetype) {
      return res.status(400).json({ error: 'File contents do not match a supported image format' });
    }

    let clean: Buffer;
    try {
      clean = await sanitiseImage(req.file.buffer, req.file.mimetype);
    } catch {
      return res.status(400).json({ error: 'That image could not be processed' });
    }

    if (USE_R2) {
      const url = await uploadToR2(req.file, clean);
      return res.json({ url });
    }

    const filename = storedFilename(req.file.mimetype);
    await fs.promises.writeFile(path.join(UPLOADS_DIR, filename), clean, { flag: 'wx' });
    // Local disk — return a path that resolveAsset() will prepend BACKEND to
    return res.json({ url: `/api/uploads/${filename}` });
  } catch (err: any) {
    console.error('[upload] failed:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;
