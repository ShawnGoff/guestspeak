-- Usernames need a different kind of match from prose.
--
-- The filter wraps every pattern in (?<![a-zA-Z0-9]) … (?![a-zA-Z0-9]), which is
-- right for a question body: it stops "class" tripping on "ass". Applied to a
-- username it is exactly backwards, because a handle is a single token and
-- running the word into other characters is the whole evasion. Measured before
-- this change, with "slur" on the list:
--
--   "slur"        blocked
--   "xXslurXx"    allowed
--   "slur99"      allowed
--   "iamaslur"    allowed
--
-- So a word now carries how it should be matched.
--
--   'word'      — only as a whole word. The default, and correct for anything
--                 that appears inside a sentence, and for terms with innocent
--                 substrings.
--   'substring' — anywhere in the text, after separators and leet-speak are
--                 normalised away. For terms that have no innocent use, where
--                 catching "xXtermXx" matters more than the risk of a false
--                 positive inside a longer legitimate word.
--
-- Existing rows keep 'word', so nothing that is filtering today changes
-- behaviour. Only new entries opt into the stricter mode.

ALTER TABLE banned_words
  ADD COLUMN IF NOT EXISTS match_mode TEXT NOT NULL DEFAULT 'word';

ALTER TABLE banned_words
  DROP CONSTRAINT IF EXISTS banned_words_match_mode_check;

ALTER TABLE banned_words
  ADD CONSTRAINT banned_words_match_mode_check
  CHECK (match_mode IN ('word', 'substring'));

-- Words that are never acceptable in a handle regardless of what surrounds
-- them, even when they are tolerable inside a sentence about them.
ALTER TABLE banned_words
  ADD COLUMN IF NOT EXISTS blocks_handles BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN banned_words.match_mode IS
  'word = whole-word only (safe default); substring = anywhere, after normalisation';
COMMENT ON COLUMN banned_words.blocks_handles IS
  'Whether this word is rejected in usernames, guest names and channel names';

-- Legitimate strings that contain a banned substring. Checked before the
-- substring pass, so "Scunthorpe" and "Hancock" survive a list that has to
-- contain what they contain.
CREATE TABLE IF NOT EXISTS banned_word_exceptions (
  id       SERIAL PRIMARY KEY,
  phrase   TEXT NOT NULL UNIQUE,
  note     TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS banned_word_exceptions_phrase_idx
  ON banned_word_exceptions (phrase);

ALTER TABLE banned_word_exceptions ENABLE ROW LEVEL SECURITY;

-- Guarded: anon/authenticated are Supabase roles and do not exist on a plain
-- Postgres, where an unguarded REVOKE aborts the whole migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON banned_word_exceptions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON banned_word_exceptions FROM authenticated;
  END IF;
END $$;
