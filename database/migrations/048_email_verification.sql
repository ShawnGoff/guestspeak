-- Migration 048: email verification.
--
-- Registration accepted any address without proof of ownership, so anyone could
-- sign up with someone else's email and have go-live mail sent to that person.
-- Sign-in is unaffected; what an unverified address loses is receiving mail
-- (go-live emails). Password reset still goes to the address on file.
--
-- Accounts that exist today are treated as verified: they have been receiving
-- mail for as long as they have existed, and forcing a re-verification would
-- silently switch off every follower's notifications.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE users SET email_verified_at = COALESCE(created_at, NOW())
 WHERE email IS NOT NULL AND email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  email       VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens (user_id);

-- Same lock-down as every other table (see 030): deny-by-default for PostgREST.
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
