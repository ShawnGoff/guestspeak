import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
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
