-- Adds an optional stream URL to sessions for hybrid event support.
-- YouTube and Twitch URLs are embedded as iframes.
-- All other URLs fall back to a "Watch live →" link.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS stream_url TEXT;
