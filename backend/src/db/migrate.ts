import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Runs all pending SQL migrations from the database/migrations directory.
 * Tracks applied migrations in a `schema_migrations` table so each file
 * only ever runs once, even across restarts.
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    // Create the tracking table if it doesn't exist.
    //
    // Locked down the same way 030_enable_rls locks every other table. This one
    // is created here rather than by a migration file, so that migration never
    // covered it and every database built by the runner had one public table
    // among the locked ones. It leaks only filenames and dates, but that is a
    // map of the schema's history handed to anyone holding the anon key.
    //
    // No policies, so PostgREST can read nothing. The runner owns the table and
    // owners bypass RLS, so its own reads and writes are unaffected.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');
    // Roles are absent on a plain Postgres database (local dev, CI), where this
    // is a no-op rather than a failure.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON schema_migrations FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON schema_migrations FROM authenticated;
        END IF;
      END $$;
    `);

    // Find migration files
    const migrationsDir = path.resolve(__dirname, '../../../database/migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('[migrate] No migrations directory found, skipping.');
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // alphabetical = chronological with numbered prefixes

    // Find which ones have already been applied
    const applied = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map((r: { filename: string }) => r.filename));

    const pending = files.filter(f => !appliedSet.has(f));

    if (pending.length === 0) {
      console.log('[migrate] All migrations up to date.');
      // Do not close the pool here — `client` is still checked out, and
      // pool.end() waits for every client to be released. The release only
      // happens in the finally block below, which cannot run until this await
      // resolves, so ending the pool here deadlocks. Let the finally do it.
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`[migrate] Applying ${file}…`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
        console.log(`[migrate] ✓ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ✗ ${file} failed:`, err);
        throw err; // Abort startup — don't run on a broken schema
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error(err);
  process.exit(1);
});
