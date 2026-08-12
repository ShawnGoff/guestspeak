-- Migration 029: web push subscriptions
--
-- A subscription is a browser's push endpoint plus the two keys needed to
-- encrypt a payload for it. One row per browser, not per user: someone with a
-- phone and a laptop has two, and both should ring.
--
-- endpoint is the natural key — the push service issues it and it is unique
-- across the world — so re-subscribing on the same browser updates in place
-- rather than accumulating duplicates.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- The push service URL to POST to. Long: FCM endpoints run past 200 chars.
  endpoint     TEXT        NOT NULL UNIQUE,

  -- Keys from the browser's PushSubscription, used to encrypt the payload so
  -- the push service relays ciphertext it cannot read.
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,

  -- Set when the push service reports the subscription is gone (404/410) so a
  -- dead endpoint is not retried forever. Rows are deleted on that signal, so
  -- this is mostly diagnostic for softer failures.
  failure_count INTEGER    NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Sends fan out by user, which is the only read pattern.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id);

COMMENT ON TABLE push_subscriptions IS
  'Web push endpoints, one row per browser. Deleted when the push service '
  'reports the subscription is gone, and when the owner deletes their account.';
