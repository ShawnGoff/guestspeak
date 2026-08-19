-- Migration 033: follow-up questions
--
-- When a host answers your question you may ask one follow-up, free of credits.
-- The point is the conversation an answer starts, which a flat queue of
-- independent questions cannot carry.
--
-- The right is derived, never stored. You may follow up on question Q if you
-- authored Q, Q is answered, and you have not already followed up on Q — all of
-- which is a query over rows that already exist. There is no token to
-- double-spend, nothing to refund, and nothing to reconcile against the credit
-- tables. Reopen a question and the right reappears because the query stops
-- matching; use it twice and the unique indexes below refuse.
--
-- parent_question_id points at the specific answered question, so Q -> F1 -> F2
-- works for as long as the host keeps answering. thread_root_id groups the whole
-- chain under the original so the UI renders one thread with a single level of
-- nesting rather than a tree.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS parent_question_id UUID REFERENCES questions (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS thread_root_id     UUID REFERENCES questions (id) ON DELETE CASCADE;

-- One follow-up per author per answered question, enforced by the database
-- rather than by a check-then-insert that two taps can race through.
--
-- Partial because parent_question_id is NULL for every ordinary question, and
-- split in two because the identity columns are mutually exclusive — the same
-- shape as chk_vote_identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_once_user
  ON questions (parent_question_id, author_id)
  WHERE parent_question_id IS NOT NULL AND author_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_once_guest
  ON questions (parent_question_id, author_guest_token)
  WHERE parent_question_id IS NOT NULL AND author_guest_token IS NOT NULL;

-- Feed reads group a thread by its root.
CREATE INDEX IF NOT EXISTS idx_questions_thread
  ON questions (thread_root_id)
  WHERE thread_root_id IS NOT NULL;
