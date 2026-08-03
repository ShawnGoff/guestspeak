-- ── IP address recording ─────────────────────────────────────────────────────
-- Records the client IP on guest user creation and session join.
-- Used for:
--   1. Platform ban enforcement (IP-level blocks)
--   2. Detecting duplicate guest accounts per session from the same IP
--
-- Note: platform_bans.ip_address already exists (migration 015).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ip_address INET;

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- Index for per-session IP cap query
CREATE INDEX IF NOT EXISTS idx_sp_session_ip
  ON session_participants (session_id, ip_address)
  WHERE ip_address IS NOT NULL;
