ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_questions_pinned ON questions (session_id) WHERE is_pinned = TRUE;
