-- Migration 021: token_version for JWT invalidation on password change
-- Incrementing this column on the user row invalidates all existing JWTs for that user.

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
