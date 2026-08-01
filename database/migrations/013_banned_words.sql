-- Stores the canonical (lowercase, plain) form of each banned word.
-- The word filter utility handles leet-speak and character substitutions at runtime.
-- Manage this list via the admin panel — never requires a redeploy.

CREATE TABLE IF NOT EXISTS banned_words (
  id         SERIAL PRIMARY KEY,
  word       TEXT        NOT NULL UNIQUE,          -- canonical lowercase form
  added_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS banned_words_word_idx ON banned_words (word);
