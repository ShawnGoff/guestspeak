import { Pool, types } from 'pg';
import { envIntMin } from '../lib/env';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Return NUMERIC columns as numbers rather than strings.
 *
 * node-postgres hands NUMERIC back as a string because the type is arbitrary
 * precision and a double cannot always hold it — the same reason COUNT() comes
 * back as a string, which once made three sessions of 15, 13 and 5 render as
 * "01513 5".
 *
 * Here it meant a session with a location could not be edited at all. The API
 * returned lat as "37.770000", the edit form put that straight back, and the
 * schema rejected it: `lat: Expected number, received string`.
 *
 * Safe as a blanket setting because sessions.lat and sessions.lng are the only
 * NUMERIC columns in the schema — organizations.lat/lng are already double
 * precision, which is the inconsistency underneath all of this. Coordinates at
 * numeric(9,6) fit a double exactly, so nothing is lost.
 *
 * If a NUMERIC column is ever added where precision genuinely matters — money,
 * most obviously — this must not stay blanket. Give that column its own cast in
 * SQL, or better, make sessions.lat/lng double precision to match
 * organizations and delete this.
 */
types.setTypeParser(types.builtins.NUMERIC, (v) => (v === null ? null : parseFloat(v)));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

/**
 * TLS config for the database connection.
 *
 * Set DATABASE_CA_CERT to the provider's CA certificate (PEM, newlines escaped
 * as \n is fine) to get a properly verified connection. Providers publish this:
 * Supabase and Railway both offer a downloadable CA bundle.
 *
 * Without it we fall back to encrypted-but-unverified, which stops passive
 * eavesdropping but not an active MITM — so it warns loudly on boot.
 */
function sslConfig() {
  if (process.env.NODE_ENV !== 'production') return false;

  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (ca) return { ca, rejectUnauthorized: true };

  console.warn(
    '[db] DATABASE_CA_CERT is not set — the database connection is encrypted ' +
    'but the server certificate is NOT verified. Set DATABASE_CA_CERT to your ' +
    "provider's CA bundle to close this gap.",
  );
  return { rejectUnauthorized: false };
}

/**
 * Simultaneous database connections. This is the server's throughput ceiling,
 * not a per-user limit: one question costs roughly eight sequential queries and
 * one echo about six, so each in-flight request holds a connection for several
 * round trips. When all are busy, further queries queue and then fail at
 * connectionTimeoutMillis.
 *
 * Configurable because the correct value is a property of the database, not the
 * code, and has to be found by measurement:
 *
 *   - Set it to what the far end will actually accept. In production that is
 *     Supabase's transaction pooler (port 6543), whose client-connection ceiling
 *     depends on the plan. Overshooting produces refused connections, which is
 *     worse than queuing — queuing degrades, refusal errors.
 *   - A local PostgreSQL usually allows 100 total, so the default stays well
 *     under that. Raise it via the environment for large events instead of
 *     hardcoding a number that breaks every developer machine.
 *   - More connections is not automatically faster. The backend is a single Node
 *     process, and past the point where PostgreSQL is saturated, extra
 *     connections add contention rather than throughput.
 */
const POOL_MAX = envIntMin('DB_POOL_MAX', 50, 1);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  // Supabase (and most managed Postgres) requires SSL in production.
  // When DATABASE_URL contains ?sslmode=require this is redundant but harmless.
  ssl: sslConfig(),
});

pool.on('error', (err) => {
  // Log and continue — crashing the process on an idle client error is too aggressive.
  // The pool will create a fresh connection on the next request.
  console.error('Unexpected error on idle PostgreSQL client', err);
});
