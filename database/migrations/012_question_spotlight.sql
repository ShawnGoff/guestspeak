-- Migration 012: Add is_spotlighted to questions (Now Answering spotlight feature)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_spotlighted BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only one spotlighted question per session at a time (low cardinality)
CREATE INDEX IF NOT EXISTS idx_questions_spotlighted ON questions (session_id) WHERE is_spotlighted = TRUE;
