-- Anonymous posting for registered users
-- Guests are already pseudonymous. This adds an opt-in anon mode for signed-in users.

-- Atomic per-session counter: increments once per anon post, never resets mid-session
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS anon_counter INT NOT NULL DEFAULT 0;

-- Per-question anon fields
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS post_anonymously BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anon_number INT; -- NULL unless post_anonymously = true

-- Partial index for quick lookup of anon posts in a session
CREATE INDEX IF NOT EXISTS idx_questions_anon
  ON questions (session_id, anon_number)
  WHERE post_anonymously = true;
