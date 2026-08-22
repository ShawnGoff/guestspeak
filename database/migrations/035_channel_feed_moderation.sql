-- Migration 035: moderation for channel feeds
--
-- Replies are free. There is no credit economy here to slow anyone down, so
-- moderation is the only brake — which is why this ships with the feed rather
-- than after it.
--
-- Two tools, matching what a session already has:
--   hiding a reply  — already possible in the schema (channel_replies.status),
--                     this migration only adds the audit trail for it
--   blocking a person from the channel's feed — the equivalent of a session ban
--
-- No guest_token column, unlike session_bans. Replying requires a registered
-- account, so there is no guest to block.

CREATE TABLE IF NOT EXISTS channel_feed_blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_by  UUID        REFERENCES users (id) ON DELETE SET NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Blocking twice is not an error, it is the same state.
  CONSTRAINT uq_channel_feed_block UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_feed_blocks_lookup
  ON channel_feed_blocks (org_id, user_id);

-- Who hid what, and when. channel_replies.status says a reply is hidden; this
-- says who decided that, which is what an author asking "why was I removed"
-- needs answering from.
ALTER TABLE channel_replies
  ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- Lock the new tables the way 030 locks every other one. Guarded on the roles
-- existing: anon and authenticated are Supabase's, and a plain Postgres
-- database (local dev, CI) has neither, where an unguarded REVOKE aborts the
-- whole migration.
ALTER TABLE channel_feed_blocks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON channel_feed_blocks FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON channel_feed_blocks FROM authenticated;
  END IF;
END $$;
