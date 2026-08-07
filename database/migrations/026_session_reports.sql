-- Migration 026: session_reports
-- Users and guests can flag a session for admin review.

CREATE TABLE IF NOT EXISTS session_reports (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  reporter_user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  reporter_guest_token TEXT,
  reason               TEXT        NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'impersonation', 'misinformation', 'other')),
  details              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One report per registered user per session
CREATE UNIQUE INDEX IF NOT EXISTS session_reports_user_uniq
  ON session_reports(session_id, reporter_user_id)
  WHERE reporter_user_id IS NOT NULL;

-- One report per guest per session
CREATE UNIQUE INDEX IF NOT EXISTS session_reports_guest_uniq
  ON session_reports(session_id, reporter_guest_token)
  WHERE reporter_guest_token IS NOT NULL;
