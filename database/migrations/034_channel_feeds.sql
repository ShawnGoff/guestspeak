-- Migration 034: channel feeds
--
-- A channel gets a feed. The host posts a prompt — "Who would you like to see
-- as a guest?" — and followers reply.
--
-- The host opens every thread. Followers reply to a prompt and cannot start
-- one, which is what keeps this from becoming the open message board that was
-- ruled out: sessions are for live events, and this is a host asking their
-- audience something between them.
--
-- Separate tables rather than reusing questions. questions.session_id is
-- NOT NULL and every feed, stat, export and moderation query joins through it,
-- so hosting channel content on a fake session would surface in Discover, in
-- channel stats and in CSV exports, each needing its own special case.
--
-- Replies are deliberately not echoable and carry no vote_count. Echoes are
-- what makes a session work; spreading the mechanic across every surface
-- dilutes it.

CREATE TABLE IF NOT EXISTS channel_prompts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- CASCADE, not SET NULL: a prompt with no author is not worth keeping, and
  -- unlike a question nobody else's reply depends on it existing.
  author_id   UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_prompts_org
  ON channel_prompts (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_replies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   UUID        NOT NULL REFERENCES channel_prompts (id) ON DELETE CASCADE,
  -- SET NULL, matching questions: a deleted account leaves the thread intact.
  author_id   UUID        REFERENCES users (id) ON DELETE SET NULL,
  -- Snapshot of the byline, same reasoning as questions.author_display_name:
  -- a name already on screen should not be rewritten by a later rename.
  author_display_name VARCHAR(255),
  body        TEXT        NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_replies_prompt
  ON channel_replies (prompt_id, created_at);

-- One reply per person per prompt, enforced by the database rather than a
-- check-then-insert that two taps can race through. Partial because author_id
-- is NULL once an account is deleted, and those rows must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_reply_once
  ON channel_replies (prompt_id, author_id)
  WHERE author_id IS NOT NULL;
