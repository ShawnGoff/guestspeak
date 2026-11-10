-- Migration 047: usernames and emails are unique regardless of case, and a
-- session ban can remember the network it came from.
--
-- users.username and users.email were UNIQUE only as exact strings, so "Alice"
-- and "alice" were two accounts: impersonation of a host by display name, and
-- ambiguous login (which lowercases the username and takes the first match).
--
-- Fails loudly on existing duplicates rather than guessing which account wins.
-- Resolve them by hand, then re-run.

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT lower(username) FROM users WHERE username IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot add case-insensitive unique index: % username(s) differ only by case', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT lower(email) FROM users WHERE email IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot add case-insensitive unique index: % email(s) differ only by case', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username))
  WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email))
  WHERE email IS NOT NULL;

-- Session bans: also record the removed participant's IP, so a banned guest
-- cannot return with a freshly minted guest token.
ALTER TABLE session_bans ADD COLUMN IF NOT EXISTS ip_address INET;
CREATE INDEX IF NOT EXISTS idx_session_bans_ip ON session_bans (session_id, ip_address)
  WHERE ip_address IS NOT NULL;
