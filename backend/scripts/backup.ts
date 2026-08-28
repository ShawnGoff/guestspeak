/**
 * Nightly database backup to R2.
 *
 * Supabase's free tier has no point-in-time recovery, so until that changes
 * this is the only thing standing between a bad migration and starting over.
 *
 * Run by a Railway cron service — see docs/backups.md. Exits non-zero on any
 * failure so Railway records the run as failed rather than quietly succeeding.
 *
 * Two rules shape the ordering below, both learned the boring way:
 *
 *   Never prune before a new backup is safely uploaded. Pruning first means a
 *   failed dump costs you the backups you already had.
 *
 *   Never upload a dump you have not sized. pg_dump can exit 0 having written
 *   almost nothing — wrong database, empty schema, permissions — and an
 *   uploaded 400-byte file that pushes a real backup out of the retention
 *   window is worse than no backup at all, because it looks like one.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const exec = promisify(execFile);

/** Keep this many of each. A month of history, at a few MB a night. */
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;

/** Sunday's dump is also filed as the week's. */
const WEEKLY_DAY = 0;

/**
 * A dump smaller than this is treated as a failure. An empty database still
 * produces several KB of schema, so anything under this means the dump did not
 * do what it was asked.
 */
const MIN_PLAUSIBLE_BYTES = 4096;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[backup] ${name} is not set — aborting.`);
    process.exit(1);
  }
  return v;
}

function r2(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${required('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function main() {
  const databaseUrl = required('DATABASE_URL');
  // Deliberately its own variable, not R2_BUCKET. That bucket is public-read
  // for avatars; a database dump must never land somewhere world-readable.
  const bucket = required('R2_BACKUP_BUCKET');

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const local = join(tmpdir(), `askaway-${stamp}.dump`);

  // -Fc: custom format. Compressed, and restorable selectively with pg_restore
  // (one table back, rather than all or nothing).
  // --no-owner / --no-privileges: the restore target is a fresh database with
  // different role names, and ownership statements only make it fail.
  console.log(`[backup] dumping to ${local}`);
  try {
    await exec('pg_dump', [
      databaseUrl, '--format=custom', '--no-owner', '--no-privileges', '--file', local,
    ], { maxBuffer: 64 * 1024 * 1024 });
  } catch (err: any) {
    // Surface pg_dump's own stderr, with the connection string scrubbed. The
    // likeliest failure by far is a version mismatch, and pg_dump says exactly
    // which two versions disagree — that message is the whole fix, so losing it
    // to a generic "command failed" would cost an hour at the worst time.
    const detail = String(err?.stderr || err?.message || err)
      .replace(/postgres(ql)?:\/\/[^\s'"]+/gi, 'postgresql://<redacted>')
      .trim();
    console.error('[backup] pg_dump failed:', detail);
    if (/server version|version mismatch/i.test(detail)) {
      console.error(
        '[backup] The pg_dump in this image is older than the server. '
        + 'Raise the postgresql pin in backend/nixpacks.toml to at least the '
        + 'server version and redeploy — pg_dump can read older servers but '
        + 'never newer ones.',
      );
    }
    process.exit(1);
  }

  const { size } = await stat(local);
  if (size < MIN_PLAUSIBLE_BYTES) {
    console.error(`[backup] dump is only ${size} bytes — refusing to upload or prune.`);
    await unlink(local).catch(() => {});
    process.exit(1);
  }
  console.log(`[backup] dump is ${(size / 1024 / 1024).toFixed(2)} MB`);

  const client = r2();
  const body = await readFile(local);
  const keys = [`daily/askaway-${stamp}.dump`];
  if (now.getUTCDay() === WEEKLY_DAY) keys.push(`weekly/askaway-${stamp}.dump`);

  for (const Key of keys) {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key,
      Body: body,
      ContentType: 'application/octet-stream',
    }));
    console.log(`[backup] uploaded ${Key}`);
  }

  await unlink(local).catch(() => {});

  // Only now, with a verified dump safely uploaded.
  await prune(client, bucket, 'daily/', KEEP_DAILY);
  await prune(client, bucket, 'weekly/', KEEP_WEEKLY);

  console.log('[backup] done');
}

/** Keep the newest `keep` objects under `prefix`; delete the rest. */
async function prune(client: S3Client, bucket: string, prefix: string, keep: number) {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
  const objects = (listed.Contents ?? [])
    .filter(o => o.Key)
    // Newest first. Sorted by key, which is the date — LastModified would
    // reorder anything ever re-uploaded.
    .sort((a, b) => (b.Key ?? '').localeCompare(a.Key ?? ''));

  const stale = objects.slice(keep);
  if (!stale.length) {
    console.log(`[backup] ${prefix} holds ${objects.length}, keeping all`);
    return;
  }

  await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: stale.map(o => ({ Key: o.Key! })) },
  }));
  console.log(`[backup] ${prefix} pruned ${stale.length}, kept ${Math.min(objects.length, keep)}`);
}

main().catch(err => {
  console.error('[backup] failed:', err?.message ?? err);
  process.exit(1);
});
