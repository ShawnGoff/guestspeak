import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  // Supabase (and most managed Postgres) requires SSL in production.
  // When DATABASE_URL contains ?sslmode=require this is redundant but harmless.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Log and continue — crashing the process on an idle client error is too aggressive.
  // The pool will create a fresh connection on the next request.
  console.error('Unexpected error on idle PostgreSQL client', err);
});
