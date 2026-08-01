-- ── Platform admin + bans ───────────────────────────────────────────────────

-- 1. Flag platform admins on the users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Platform bans — cross-session, managed by platform admins only.
--    At least one of user_id / guest_token / ip_address must be set.
CREATE TABLE IF NOT EXISTS platform_bans (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  guest_token  VARCHAR(255),
  ip_address   INET,
  reason       TEXT        NOT NULL,
  -- NULL = permanent
  expires_at   TIMESTAMPTZ,
  banned_by    UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  banned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_platform_ban_has_target
    CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL OR ip_address IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_platform_bans_user        ON platform_bans (user_id)     WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_bans_guest_token ON platform_bans (guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_bans_ip          ON platform_bans (ip_address)  WHERE ip_address IS NOT NULL;

-- 3. Audit log — records whenever an admin reveals the real identity behind
--    an anonymous post. Immutable: INSERT only, never UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS admin_action_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action      VARCHAR(50) NOT NULL,   -- e.g. 'identity_reveal', 'platform_ban', 'word_add'
  target_type VARCHAR(50),            -- 'question', 'user', 'session', etc.
  target_id   TEXT,                   -- the ID of the thing acted on
  notes       TEXT,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_admin ON admin_action_log (admin_id, performed_at DESC);
