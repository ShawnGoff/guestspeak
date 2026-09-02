# Database backups

Supabase's free tier has no point-in-time recovery. Until that changes, the
nightly dump to R2 is the only thing between a bad migration and starting over.

`backend/scripts/backup.ts` dumps the database, uploads it to R2, and prunes old
copies. A Railway cron service runs it.

## What it keeps

| Prefix    | Kept | Written                  |
| --------- | ---- | ------------------------ |
| `daily/`  | 7    | every run                |
| `weekly/` | 4    | Sundays (UTC), as well   |

So roughly a month of history. At the current size a dump is well under a
megabyte, and R2's free tier covers this comfortably.

Two ordering rules the script enforces, because getting them wrong turns a
backup system into a way of losing backups:

- **Pruning happens only after a new dump is uploaded.** Prune first and a
  failed dump costs you the history you already had.
- **A dump under 4 KB is rejected, not uploaded.** `pg_dump` can exit 0 having
  written almost nothing — wrong database, permissions, empty schema. Uploading
  that and letting it push a real backup out of the window is worse than no
  backup, because it looks like one. For reference, an empty database with the
  full schema dumps to about 86 KB.

## Setting up the Railway cron

1. **Create a private R2 bucket**, separate from the uploads bucket — call it
   something like `guestspeak-backups`.

   It must not be public. The uploads bucket is public-read so avatars can be
   served from it; a database dump in a public bucket is a full disclosure of
   every account, question and email address. Do not attach a custom domain or
   enable public access on this one.

2. **Create an R2 API token** scoped to that bucket with **Object Read & Write**.
   The upload token cannot be reused — it is scoped to the uploads bucket, and
   the backup job needs delete permission to prune.

3. **Add a new service in Railway** from the same repo (New → GitHub Repo):
   - Root directory: `backend`
   - Builder: **Railpack** (the default; Nixpacks is deprecated)
   - Build command: **empty**
   - Start command: `npm run backup`
   - Cron schedule: `0 11 * * *`

   Railway runs the container on that schedule and stops it when the process
   exits. The script exits non-zero on any failure, so a failed run shows as
   failed rather than silently succeeding.

   **Start command, not build command.** Putting `npm run backup` in the build
   field runs the dump while the image is being assembled — it failed the whole
   deploy rather than one run, and the deploy command stayed the default
   `npm run start`. The giveaway is in the build log: `npm run backup` should
   appear under `Deploy`, never under `Steps ▸ build`.

   **Cron times are UTC**, with no daylight-saving adjustment. `0 11 * * *` is
   04:00 PDT / 03:00 PST — deliberately not evening, which is when a live-events
   product is busiest. The obvious-looking `0 4 * * *` is 9pm Pacific, roughly
   the worst hour available. At the current size the dump takes about a second
   and would disturb nothing whenever it ran, but that stops being true as the
   database grows.

   Railway will warn that no port is exposed and that the healthcheck fails.
   Ignore both — a cron job has no HTTP server.

4. **Set these variables** on that service:

   | Variable               | Notes                                            |
   | ---------------------- | ------------------------------------------------ |
   | `DATABASE_URL`         | Same as the API service                          |
   | `R2_ACCOUNT_ID`        | Same as uploads                                  |
   | `R2_ACCESS_KEY_ID`     | The new backup-scoped token                      |
   | `R2_SECRET_ACCESS_KEY` | The new backup-scoped token                      |
   | `R2_BACKUP_BUCKET`     | The private bucket — **not** `R2_BUCKET`         |

   `R2_BACKUP_BUCKET` is deliberately a different variable from `R2_BUCKET` so
   a dump can never be written to the public bucket by a copied config.

5. **Trigger it once by hand** from the Railway UI and read the log. A first run
   should say:

   ```
   [backup] dumping to /tmp/askaway-YYYY-MM-DD.dump
   [backup] dump is 0.08 MB
   [backup] uploaded daily/askaway-YYYY-MM-DD.dump
   [backup] daily/ holds 1, keeping all
   [backup] done
   ```

## The Postgres version pin

`backend/railpack.json` installs `postgresql-client-17` so `pg_dump` exists in
the image at all — Railway's Node image does not include it, and without this
the run fails with `spawn pg_dump ENOENT`.

It has to be Railpack's config file. `backend/nixpacks.toml` says the same
thing and is read by nothing: Railway builds new services with Railpack, which
does not understand it, and Nixpacks is deprecated. That file survives only
because the older API service may still be built by Nixpacks; once that service
is confirmed migrated, delete it rather than leave two build configs that
disagree.

`railpack.json` is shared by both services — they both root at `backend/` — so
it must hold only what is true for both. In particular **no `startCommand`**:
the API needs its server and the backup needs `npm run backup`, and a start
command there would be picked up by whichever service Railway migrates next,
leaving an API quietly running the backup script instead of listening. Start
commands stay per-service in the Railway UI.

**`pg_dump` must be the same version as the server or newer.** It can read older
servers; it refuses newer ones outright:

```
pg_dump: error: server version: 18.4; pg_dump version: 14.8
pg_dump: error: aborting because of server version mismatch
```

The script detects that message and prints the fix. To check what Supabase is
running:

```sql
SHOW server_version;
```

As of 2026-09-02 it reports **17.6**, which `postgresql-client-17` covers —
the check is on the major version, so a 17.x client dumps any 17.x server.

If it ever reports 18 or higher, raise `postgresql-client-17` in
`backend/railpack.json` to match and redeploy. Supabase moves its Postgres
version without asking, and the pin is currently level with the server rather
than ahead of it, so this will come up.

## Restoring

Download the dump from R2, then restore into a **fresh** database — never over a
live one:

```bash
createdb askaway_restore
pg_restore --dbname askaway_restore --no-owner --no-privileges askaway-2026-08-28.dump
```

Check it landed before pointing anything at it:

```bash
psql askaway_restore -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
psql askaway_restore -c "SELECT count(*) FROM schema_migrations;"
```

The dumps are custom-format, so `pg_restore` can also pull back a single table
rather than everything — useful when one table was damaged and the rest is fine:

```bash
pg_restore --dbname askaway_restore --table questions askaway-2026-08-28.dump
```

## Testing it

Run against a local database without touching R2 — it will dump, size-check,
then fail at upload, which is far enough to prove the first half:

```bash
cd backend && DATABASE_URL="postgresql://localhost:5432/askaway" R2_ACCOUNT_ID=notreal R2_ACCESS_KEY_ID=x R2_SECRET_ACCESS_KEY=x R2_BACKUP_BUCKET=fake npm run backup
```

**A backup nobody has restored is a hypothesis.** Restore one into a scratch
database occasionally and confirm the table count and migration count match
production.

### The restore done on 2026-09-02

The first nightly dump was pulled from R2 and restored locally, so these are
real numbers to compare against rather than a guess:

```
archive:    297 KB, custom format
            dumped from 17.6, by pg_dump 17.11 (Debian)
restored:   24 public tables
            users 5 · organizations 1 · sessions 1 · questions 4
            banned_words 79
```

`pg_restore` exits 1 with three errors, all of them `supabase_vault` — a
Supabase extension that does not exist in vanilla Postgres. Expected, and
harmless: nothing in this app touches it, and restoring into a real Supabase
project would not raise them. Do not treat that exit code as a failed restore;
read the errors.

That restore also caught something the dump made visible and nothing else
would have: `session_reminders` existed in production while `schema_migrations`
stopped at `043`. Migration 044 had been pasted into the Supabase SQL editor
rather than applied by the runner, which creates the table without recording
it. Harmless here because 044 is idempotent, but it is worth knowing that
**pasting SQL and running the migrator are not equivalent** — the ledger only
tracks the latter, and nothing runs the migrator automatically on deploy.
