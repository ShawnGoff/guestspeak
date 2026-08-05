-- Migration 025: anon_credits
-- Registered users can post anonymously; this separate credit pool caps spam.
-- Default 2, never replenished, independent of credits_remaining.

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS anon_credits SMALLINT NOT NULL DEFAULT 2;
