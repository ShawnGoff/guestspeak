-- Migration 036: a window to fix your own reply
--
-- Replies were permanent, and because there is one reply per person per prompt
-- a typo was forever: you could not fix it and you could not try again. That is
-- harsher than anything else here — an ordinary question you can simply re-ask
-- for a credit.
--
-- Five minutes, not the sixty seconds a question gets. A question's window is
-- short because a live room acts on it fast, and the deadline exists to stop an
-- author rewriting words people have already echoed. Nothing accumulates on a
-- channel reply: they are asynchronous and cannot be echoed, so the pressure
-- that justifies sixty seconds is absent.
--
-- Separate from any future updated_at, for the same reason questions.edited_at
-- is separate: only this column means the author changed the words.
ALTER TABLE channel_replies
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
