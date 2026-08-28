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

3. **Add a new service in Railway** from the same repo:
   - Root directory: `backend`
   - Start command: `npm run backup`
   - Cron schedule: `0 4 * * *` (04:00 UTC — pick a quiet hour for your audience)

   Railway runs the container on that schedule and stops it when the process
   exits. The script exits non-zero on any failure, so a failed run shows as
   failed rather than silently succeeding.

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

`backend/nixpacks.toml` installs `postgresql_17` so `pg_dump` exists in the
image at all — Railway's Node image does not include it, and without this the
first run fails with `pg_dump: not found`.

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

If it reports 18 or higher, raise the pin in `backend/nixpacks.toml` to match
and redeploy.

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
