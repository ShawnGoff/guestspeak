-- ── Moderation controls ────────────────────────────────────────────────────
-- Adds: question approval queue, participant muting, session bans,
--       and expanded moderator permission columns.

-- 1. Optional approval queue toggle on sessions
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false;

-- 2. Add 'pending' status for questions awaiting host/mod approval.
--    Pending questions are hidden from the audience until approved.
ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_status_check;
ALTER TABLE questions
  ADD CONSTRAINT questions_status_check
  CHECK (status IN ('pending', 'new', 'starred', 'answered', 'hidden'));

-- 3. Participant muting — muted users stay in the session but cannot
--    submit new questions or Echoes for its duration.
ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS is_muted   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS muted_by   UUID        REFERENCES users(id) ON DELETE SET NULL;

-- 4. New moderator permission columns
ALTER TABLE session_moderators
  ADD COLUMN IF NOT EXISTS can_mute    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_remove  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_approve BOOLEAN NOT NULL DEFAULT false;

-- 5. Session-level bans — removed participants cannot rejoin.
--    This is distinct from a platform ban (handled by admins separately).
CREATE TABLE IF NOT EXISTS session_bans (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES sessions(id)  ON DELETE CASCADE,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  guest_token VARCHAR(255),
  banned_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ban_identity CHECK (
    (user_id IS NOT NULL AND guest_token IS NULL)
    OR
    (user_id IS NULL AND guest_token IS NOT NULL)
  ),
  UNIQUE (session_id, user_id),
  UNIQUE (session_id, guest_token)
);

CREATE INDEX IF NOT EXISTS idx_session_bans_session ON session_bans (session_id);
CREATE INDEX IF NOT EXISTS idx_session_bans_user    ON session_bans (user_id)
  WHERE user_id IS NOT NULL;
