-- "Tell me when this one starts."
--
-- Following a channel already notifies you about everything it puts on. That is
-- the right unit for a show you watch every week and the wrong one for a single
-- session you saw on Discover — a conference talk, a one-off panel, a guest you
-- care about on a station you otherwise do not follow.
--
-- Registered accounts only, because notifications.user_id is NOT NULL and a
-- guest has nowhere to receive one. The button prompts a signed-out visitor to
-- sign up, which is what the follow button already does.
--
-- No expiry and no cleanup job. A reminder is answered when the session goes
-- live and is meaningless afterwards, but the row is small and deleting it on
-- send would lose the record of who asked — useful the first time someone says
-- they never got told.

CREATE TABLE IF NOT EXISTS session_reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Stamped when the go-live notification went out, so a reopen cannot double-send. */
  notified_at TIMESTAMPTZ,

  -- One per person per session. The uniqueness is the enforcement: setting a
  -- reminder twice is a no-op rather than a duplicate notification.
  UNIQUE (session_id, user_id)
);

-- The go-live fan-out reads by session; the card state reads by user.
CREATE INDEX IF NOT EXISTS session_reminders_session_idx
  ON session_reminders (session_id) WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS session_reminders_user_idx
  ON session_reminders (user_id);

ALTER TABLE session_reminders ENABLE ROW LEVEL SECURITY;

-- Guarded: anon/authenticated are Supabase roles and do not exist on a plain
-- Postgres, where an unguarded REVOKE aborts the whole migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON session_reminders FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON session_reminders FROM authenticated;
  END IF;
END $$;
