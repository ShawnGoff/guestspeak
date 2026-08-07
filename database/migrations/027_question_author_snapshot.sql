-- Migration 027: snapshot the author's display name onto the question
--
-- The byline used to be resolved at read time by joining questions to
-- session_participants (for guests) or users (for registered accounts). Both
-- joins read mutable rows, which caused two bugs:
--
--   1. Removing a guest deletes their session_participants row, so every
--      question they had already posted lost its byline entirely — the name
--      simply stopped rendering, leaving what looked like an unattributed post.
--
--   2. A guest who rejoined under a different name updated guest_username on the
--      same participant row, retroactively rewriting the author on every question
--      they had posted earlier in the session.
--
-- A byline is a fact about the moment a question was written, so it is stored
-- with the question instead of looked up later.

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS author_display_name TEXT;

-- Backfill from whichever source currently resolves the name.
-- Questions whose guest participant was already removed cannot be recovered —
-- those stay NULL and render via the application's fallback label.
UPDATE questions q
SET author_display_name = COALESCE(
  (SELECT u.username
     FROM users u
    WHERE u.id = q.author_id
      AND u.is_guest = false),
  (SELECT sp.guest_username
     FROM session_participants sp
    WHERE sp.session_id = q.session_id
      AND q.author_guest_token IS NOT NULL
      AND sp.guest_token = q.author_guest_token)
)
WHERE q.author_display_name IS NULL;
