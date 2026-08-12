-- Migration 028: account deletion
--
-- Apple requires any app offering account creation to offer in-app account
-- deletion (App Store Review Guideline 5.1.1(v)), and GDPR erasure requests need
-- the same thing. Neither is possible today.
--
-- Deletion is implemented as anonymisation rather than a DELETE, because a real
-- DELETE cannot work here:
--
--   * sessions.host_id is ON DELETE RESTRICT, so deleting a host fails outright
--   * cascading instead would take every question in that host's sessions with
--     it — content written by other people, which is not the departing user's
--     to erase
--   * platform_bans.user_id is ON DELETE SET NULL, so deleting a banned user's
--     row would quietly void their ban and let them re-register
--
-- Keeping the row and stripping every personal field satisfies erasure (no
-- personal data remains), preserves other people's content, keeps moderation
-- history intact, and keeps bans enforceable.
--
-- email, username, password_hash and code_prefix are all nullable with UNIQUE
-- indexes; PostgreSQL permits many NULLs under a UNIQUE constraint, so several
-- deleted accounts coexist without collision and the freed username becomes
-- available again.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Deleted accounts are excluded from every lookup (login, search, profiles), so
-- index the live ones.
CREATE INDEX IF NOT EXISTS idx_users_active
  ON users (id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN users.deleted_at IS
  'Set when the user deletes their account. The row is retained but every '
  'personal field is nulled: it exists only to keep foreign keys valid, '
  'preserve other people''s content, and keep platform bans enforceable.';
