-- Migration 030: enable Row-Level Security on every public table
--
-- Supabase auto-generates a PostgREST API over everything in the `public`
-- schema, reachable at the project URL with the `anon` key. That key is public
-- by design — Supabase's model assumes it is known and relies on RLS to control
-- access. With RLS disabled, anything holding it can read and write every table
-- directly, including users.email, users.password_hash and users.ip_address.
--
-- This application never uses PostgREST. It connects straight to PostgreSQL from
-- Express with an ordinary connection string, so that entire API surface is pure
-- attack surface with no benefit.
--
-- Enabling RLS with NO policies denies everything to the roles PostgREST uses
-- (`anon`, `authenticated`). It does not affect the backend: the app connects as
-- `postgres`, which owns these tables, and table owners bypass RLS.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT used. That is what makes owners
-- subject to their own policies — with no policies defined, it would lock the
-- application out of its own database.
--
-- If PostgREST is ever wanted, add explicit policies then. Deny-by-default is
-- the right starting point; the current state is allow-by-default.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Defence in depth: Supabase grants table privileges to anon/authenticated by
-- default, so revoke them too. RLS alone is sufficient, but a future table
-- created without RLS would otherwise be exposed again by these grants.
--
-- Guarded because these roles exist only on Supabase — a local PostgreSQL has
-- neither, and this migration has to run in both places.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
