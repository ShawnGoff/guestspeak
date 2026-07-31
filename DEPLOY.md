# GuestSpeak — Deployment Guide

## Architecture

| Layer | Service | Why |
|-------|---------|-----|
| Frontend | Vercel | Next.js native, zero-config |
| Backend API | Railway | Express + SSE requires persistent connections — serverless won't work |
| Database | Supabase | Managed Postgres, free tier generous |
| Email | Resend | Simple SMTP, free tier = 3k emails/month |
| File storage | Supabase Storage or Cloudflare R2 | Local disk is ephemeral on Railway |

> **Important:** The backend cannot run on Vercel. Server-Sent Events (SSE) keep HTTP connections open for minutes at a time — Vercel serverless functions time out in seconds. Use Railway, Render, or Fly.io for the Express backend.

---

## 1. Supabase (database)

1. Create a new project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the entire contents of `database/migrations/001_initial_schema.sql`.
3. Then run each subsequent migration in order:
   ```
   002_password_reset_tokens.sql
   003_featured_sessions.sql
   004_user_follows.sql
   005_flags_unique_constraint.sql
   006_guest_username.sql
   007_org_location.sql
   008_session_online.sql
   009_org_categories.sql
   010_org_online.sql
   011_question_pin.sql
   012_question_spotlight.sql
   ```
4. Enable extensions (Dashboard → Database → Extensions):
   - `pgcrypto` ✓ (usually enabled by default)
   - `cube` ✓ (required by earthdistance)
   - `earthdistance` ✓ (for Nearby discovery)
5. Copy your **Transaction pooler** connection string from Settings → Database → Connection string (use port **6543**, not 5432, to stay within connection limits).

---

## 2. Railway (backend)

1. Create a new Railway project, add a new **Empty service**, connect your repo.
2. Set the root directory to `ask-away/backend`.
3. Set build command: `npm run build`
4. Set start command: `npm start`
5. Add environment variables (copy from `backend/.env.example`):
   - `DATABASE_URL` — Supabase pooler URL
   - `JWT_SECRET` — generate with `openssl rand -base64 64`
   - `FRONTEND_URL` — your Vercel URL (set after step 3)
   - `APP_URL` — same as FRONTEND_URL
   - `NODE_ENV=production`
   - SMTP vars (see email section below)
6. After deploy, note your Railway public URL (e.g. `https://guestspeak-api.railway.app`).

### File uploads

Local disk storage is ephemeral on Railway — uploaded avatars are lost on redeploy. Before going live, update `src/routes/upload.ts` to write to **Supabase Storage**:

```bash
npm install @supabase/supabase-js
```

Then replace the `multer.diskStorage` logic with `supabase.storage.from('avatars').upload(...)` and return the public URL. Add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to Railway env vars.

---

## 3. Vercel (frontend)

1. Import your repo in Vercel. Set root directory to `ask-away/frontend`.
2. Add environment variables:
   - `NEXT_PUBLIC_API_URL` — your Railway backend URL (no trailing slash, no /api)
     Example: `https://guestspeak-api.railway.app`
   - `NEXT_PUBLIC_API_HOST` — just the hostname: `guestspeak-api.railway.app`
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL (if using Supabase Storage for images)
3. Deploy. Note your Vercel URL and go back to Railway to set `FRONTEND_URL` and `APP_URL`.

---

## 4. Email (Resend)

1. Sign up at [resend.com](https://resend.com), create an API key.
2. Add a domain and verify DNS (or use their sandbox for testing).
3. Set in Railway:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASS=re_your_key
   SMTP_FROM=GuestSpeak <noreply@yourdomain.com>
   ```

---

## 5. Custom domain (optional)

- **Frontend**: Vercel → Project → Settings → Domains.
- **Backend**: Railway → Service → Settings → Networking → Custom Domain.
- Update `FRONTEND_URL`, `APP_URL`, and `NEXT_PUBLIC_API_URL` to match.

---

## Post-deploy checklist

- [ ] All 12 migrations ran successfully in Supabase
- [ ] `earthdistance` and `cube` extensions enabled
- [ ] Health check returns 200: `curl https://your-api.railway.app/health`
- [ ] Register a test account, create a session, go live
- [ ] Password reset email arrives
- [ ] Avatar upload works (or Supabase Storage wired up)
- [ ] Org follower notification email arrives when session goes live
- [ ] SSE updates appear in real time (session page)
