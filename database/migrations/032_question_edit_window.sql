-- Migration 032: a short window to fix a question after posting
--
-- Questions were immutable. That is right for anything the room has acted on —
-- an echo is an endorsement of specific words, and letting the author rewrite
-- them afterwards means people are backing text they never read — but it left
-- no way to fix a typo, and a question is written in a hurry while a show is
-- running. Follow-ups make it sharper still: that right is single-use, so a
-- fumbled one is gone with no way to re-ask.
--
-- One minute from posting, author only. Long enough to catch a mistake, short
-- enough that little has been built on it yet.
--
-- edited_at is separate from updated_at, which already moves for status
-- changes, pins, and host replies. Only this column means the author changed
-- the words, which is what the UI needs to mark.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
