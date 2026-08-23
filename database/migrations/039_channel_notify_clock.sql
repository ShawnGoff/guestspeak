-- Migration 039: keep the prompt-notification cooldown on the channel
--
-- 037 indexed the old approach, which asked "have this channel's followers been
-- notified recently" by looking for notification rows. That made a wrong answer
-- fast rather than making it right, and two problems survive an index:
--
--   Notification rows are deletable. A follower can delete theirs, and account
--   deletion removes them wholesale — so on a channel with few followers the
--   cooldown silently resets and the next prompt notifies again.
--
--   It is a check-then-act. Two prompts posted at the same moment both see no
--   recent row and both fan out.
--
-- The channel is the thing being rate-limited, so the clock belongs on it. One
-- primary-key lookup, nothing to scan, and it cannot be cleared by anybody
-- tidying their notifications.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS followers_notified_at TIMESTAMPTZ;

-- 037's index only ever answered the query this replaces, and an unused index
-- is not free: it is maintained on every notification insert, which is one row
-- per follower per go-live.
DROP INDEX IF EXISTS idx_notifications_channel_prompt;
