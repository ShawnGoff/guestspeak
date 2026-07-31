-- 008: Add is_online flag to sessions
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;
