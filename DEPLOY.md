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
2. Enable extensions (Dashboard → Database → Extensions) **before** running migrations:
   - `pgcrypto` ✓ (usually enabled by default)
   - `cube` ✓ (required by earthdistance)
   - `earthdistance` ✓ (for Nearby discovery)
3. Copy your **Transaction pooler** connection string from Settings → Database → Connection string (use port **6543**, not 5432, to stay within connection limits).
4. Run the migrations — see below.

### Running migrations

Do not paste migration files in by hand. `npm run migrate` applies every pending
file in `database/migrations` in filename order and records each one in a
`schema_migrations` table, so it is safe to re-run and never applies the same
file twice. Each migration runs in its own transaction and startup aborts on the
first failure rather than leaving a half-applied schema.

```bash
cd backend && DATABASE_URL="<your-connection-string>" npm run migrate
```

**Run migrations before the code that needs them reaches production.** Railway
deploys on push to `main`, so a push containing both a migration and the code
that reads its column ships the code first, and the gap between the two is an
outage. It has happened: two additive columns went out ahead of their
migrations and every question feed returned 500 until the SQL was applied,
because the projection selected a column the database did not have.

Additive migrations are safe to apply early and unsafe to apply late. Apply
them, confirm, then push. Rolling the code back does not help if the migration
is the missing half.

That is the whole process for a fresh database, and the only step needed for
every migration added from here on. This section deliberately does not list the
migration files: the previous version enumerated them, fell fifteen behind, and
silently produced a broken schema for anyone following it.

### Adopting the migration runner on a hand-migrated database

If a database was set up by pasting SQL into the Supabase SQL Editor, its
`schema_migrations` table is empty, so `npm run migrate` would try to replay
everything from `001` — which fails immediately, because `001_initial_schema.sql`
uses bare `CREATE TABLE` with no `IF NOT EXISTS`.

Tell the runner what has already been applied, once, before the first
`npm run migrate` against that database.

Generate the list rather than typing it. This section used to enumerate the
filenames, fell fifteen behind, and silently produced a broken schema for
anyone following it — then drifted again the moment two more were added:

```bash
ls database/migrations/*.sql | xargs -n1 basename | sed "s/.*/  ('&'),/"
```

Paste the output below, **delete the lines for anything not yet applied**, and
drop the trailing comma on the last one. Anything you leave in is recorded as
done and will never run; anything you take out runs on the next
`npm run migrate`.

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Matches what 030 does to every other table. The runner owns this one and
-- owners bypass RLS, so its own reads and writes still work.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON schema_migrations FROM anon, authenticated;

INSERT INTO schema_migrations (filename) VALUES
  -- ← generated list goes here
ON CONFLICT (filename) DO NOTHING;
```

When you are unsure whether one was applied, test for it instead of guessing.
A security migration recorded as done that never ran is worse than one that
runs twice:

```sql
INSERT INTO schema_migrations (filename)
SELECT '030_enable_rls.sql'
 WHERE EXISTS (
   SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'questions' AND rowsecurity
 )
ON CONFLICT (filename) DO NOTHING;
```

Verify with `SELECT count(*) FROM schema_migrations;` — it should match the
number of `.sql` files in `database/migrations`. After this, `npm run migrate`
picks up from wherever you left off.

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

- [ ] `npm run migrate` reports all migrations applied
- [ ] `SELECT count(*) FROM schema_migrations;` matches the file count in `database/migrations`
- [ ] `earthdistance` and `cube` extensions enabled
- [ ] Health check returns 200: `curl https://your-api.railway.app/health`
- [ ] Register a test account, create a session, go live
- [ ] Password reset email arrives
- [ ] Avatar upload works (or Supabase Storage wired up)
- [ ] Org follower notification email arrives when session goes live
- [ ] SSE updates appear in real time (session page)
- [ ] Replica count is 1, **or** `REDIS_URL` is set (see Scaling limits)
- [ ] Hiding a question as host survives a page reload
- [ ] A session link in a private window reaches the session, not `/login`
- [ ] Guest credit meter ticks, and the sign-up prompt fires when regen runs out

---

## Scaling limits

### Running more than one replica

**Set `REDIS_URL` before raising Railway's replica count above 1.**

SSE connections live in the memory of whichever replica the client reached. Sends
go through a Redis pub/sub bus (`src/sse/bus.ts`) so every replica receives every
event and writes to the sockets it happens to hold. Without Redis the bus calls
straight through to local delivery — correct for a single instance, and silently
wrong for more than one.

The failure mode is worth understanding, because it does not look like a failure.
A client connected to replica A never receives events produced on replica B. The
connection is open and healthy, heartbeats fine, and reports no error. The feed
simply goes quiet for part of the audience, and the client-side fallback never
triggers because nothing failed.

It also hits *small* sessions hardest. Above `LIVE_FEED_MAX_PARTICIPANTS` the
audience polls instead of streaming, so large sessions are unaffected — but a
fifty-person meetup has everyone on SSE, and half of them stop seeing questions.

`tests/e2e-replicas.py` covers this: it runs two replicas against one Redis and
one database, writes exclusively through one, and asserts listeners on both see
the event. With `REDIS_URL` unset, eight of its sixteen assertions fail — that is
the bug, reproducible on demand.

Everything else is already replica-safe:

- the auto-go-live scheduler uses a single atomic `UPDATE … RETURNING`, so only
  one replica ever claims a session
- the feed cache is read-only derived data; each replica keeps its own copy and
  both go stale by at most one TTL
- rate-limit counters are per process and advisory, not a security boundary, so
  N replicas weaken them proportionally

Two caveats when running multiple replicas:

- `SSE_MAX_CLIENTS_PER_SESSION` is counted per replica, so the effective cap is
  N times the configured value
- `DB_POOL_MAX` is also per replica. Supabase's pooler enforces a fixed client
  ceiling (200 on Nano), and a deploy briefly runs old and new containers at
  once — size the pool so `2 × N × DB_POOL_MAX` stays under it

### Very large sessions (thousands of attendees)

Above `LIVE_FEED_MAX_PARTICIPANTS` (default 400) the audience stops receiving a
live SSE stream. `GET /api/sessions/:slug` returns `feed_mode: 'polling'` and the
client re-fetches the feed every `FEED_POLL_INTERVAL_MS` instead. Hosts and
moderators always get `feed_mode: 'live'` regardless of session size — there are
only ever a handful of them and they are the ones who need immediacy.

This exists because per-event fan-out is O(clients × events) in a single process.
At 60k connections one echo means 60k socket writes; the model that feels great in
a room of 50 cannot survive a stadium.

Polling is made cheap by a short-TTL read cache (`FEED_CACHE_TTL_MS`, default 2s)
in `src/lib/feedCache.ts`. N pollers cost roughly one query per TTL rather than N
queries. Only the plain audience feed is cached — moderator views and the pending
queue always read through, and every moderation action invalidates the session's
cache immediately, so hiding a question is never delayed by the TTL.

Unlike the broadcaster, this cache is replica-safe: it is read-only derived data,
so a second replica just keeps its own copy.

**What is still required before a genuinely huge event:**

1. Redis pub/sub for the broadcaster (above), so you can run multiple replicas.
2. Raise `pool.max` in `src/db/pool.ts` above 20, and size the Postgres side to
   match. Question and echo submission are the write hot paths.
3. Load-test the write path specifically. Reads are cached; writes are not.

### Guests and IP-based limits

`GUEST_IP_TOKEN_CAP` (default 2000, `0` disables) caps distinct guest tokens per
IP per session. Be aware that IP is a weak identity signal at venue scale: a
conference NAT or a stadium's carrier-grade NAT puts thousands of genuinely
distinct attendees behind a handful of addresses, and from the server a farming
loop and a filling arena look identical. Set it to `0` for large ticketed events.

Echo is intentionally open to guests. Ballot-stuffing is bounded by one vote per
identity per question plus the credit budget (~8 echoes per guest token), not by
IP. If that ever needs tightening, requiring sign-in to Echo is the lever — not a
lower IP cap.

### Rate limiting

`apiLimiter` is keyed on the authenticated caller, falling back to IP for
anonymous requests. This matters at conferences: a venue puts every attendee
behind one NAT address, and a purely IP-keyed limit throttles the entire room as
though it were a single abusive client. The pre-auth limiters (login, register,
guest issuance) stay IP-keyed on purpose — that is what makes them useful against
brute force.

Rate-limit counters are also per-process. They are advisory, not a security
boundary, so a second replica would weaken them proportionally.
