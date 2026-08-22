-- Migration 037: index the channel-prompt notification lookup
--
-- The prompt fan-out asks "have this channel's followers been notified in the
-- last few hours" by querying notifications on type and payload->>'org_id'.
-- Both existing indexes on the table are keyed on user_id, so that question was
-- answered by a sequential scan — fine on an empty table, and progressively
-- less fine as notifications accumulate one row per follower per go-live and
-- per prompt.
--
-- Partial, because it only ever answers this one question and there is no
-- reason to carry every session:live row in it.
CREATE INDEX IF NOT EXISTS idx_notifications_channel_prompt
  ON notifications ((payload->>'org_id'), created_at DESC)
  WHERE type = 'channel:prompt';
