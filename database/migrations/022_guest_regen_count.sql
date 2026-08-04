-- Track how many regen credits a guest has received in a session.
-- Guests are capped at 2 regen credits lifetime per session; after that they must sign up.
-- Registered users use a ceiling-based approach (USER_CREDIT_CAP) and don't need this column.
ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS regen_count INT NOT NULL DEFAULT 0;
