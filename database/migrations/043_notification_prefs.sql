-- Somewhere to record "stop emailing me".
--
-- The go-live email had no unsubscribe link and no List-Unsubscribe header, so
-- the only way off the list was to unfollow the channel. That is a compliance
-- problem rather than a missing feature: CAN-SPAM requires a working opt-out on
-- commercial mail, and Gmail and Yahoo both require the header from bulk
-- senders or they route the mail to spam.
--
-- JSONB rather than columns because the shape is not settled — per-channel
-- muting and in-app toggles are both likely next, and neither should need a
-- migration. Absent key means subscribed, so this deploy changes nobody's
-- behaviour and a notification type added later is on by default.
--
-- Keys in use:
--   email_session_live  false = do not email me when a channel I follow goes live
--
-- Password reset is deliberately not in here. It is transactional — a reply to
-- something the person just did — and must send regardless.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.notification_prefs IS
  'Opt-outs only. Absent key = subscribed. Never gates transactional mail.';
