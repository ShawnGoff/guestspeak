-- Migration 031: pause credit regeneration until a session is live
--
-- Sessions are event-shaped: created ahead, taken live, closed. The window
-- before go-live is for queuing questions, and a podcast may open one weeks
-- out. Regeneration ran through that whole window, so a listener who joined a
-- week early could spend, wait ten minutes, and spend again — about a thousand
-- times before anyone said a word. The opening allocation was never the bound;
-- the clock was.
--
-- Regen now requires status = 'live'. went_live_at records the moment so the
-- go-live top-up has a value to stamp on last_credit_at, which is what stops
-- every pre-registered participant becoming eligible at once the instant the
-- show starts.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS went_live_at TIMESTAMPTZ;

-- Sessions already live predate the column. Fall back to created_at: it is the
-- only timestamp guaranteed present, and for a session that is already running
-- any value in the past behaves identically — the regen guard only asks whether
-- the interval has elapsed.
UPDATE sessions
   SET went_live_at = created_at
 WHERE status = 'live'
   AND went_live_at IS NULL;
