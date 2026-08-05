-- Per-participant question burst tracking
-- Allows 2 quick questions, then a 30-second cooldown before the next burst
ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS last_question_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS question_burst   INT NOT NULL DEFAULT 0;
