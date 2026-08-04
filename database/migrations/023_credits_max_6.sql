-- Raise credits_per_user cap from 5 → 6
ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_credits_per_user_check;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_credits_per_user_check
  CHECK (credits_per_user BETWEEN 1 AND 6);
