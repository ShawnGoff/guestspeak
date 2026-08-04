import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireRegistered } from '../middleware/auth';

const router = Router();

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(null, ok);
    if (!ok) cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  },
});

// POST /api/upload — returns { url: '/uploads/<filename>' }
router.post('/', requireRegistered, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/api/uploads/${req.file.filename}` });
});

export default router;
