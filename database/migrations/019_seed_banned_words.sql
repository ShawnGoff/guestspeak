-- Seed banned_words table with baseline slurs
-- Scope: racial, ethnic, homophobic, and transphobic slurs only.
-- General profanity is excluded (context-dependent, rabbit hole).
-- Common letter substitutions are handled at query time by the word filter logic,
-- so we store the base forms here.

-- The list itself is not in this repository.
--
-- It lives in database/seeds/banned-words.sql, which is gitignored, alongside
-- the terms that were originally seeded in 042. Apply it with:
--
--   psql "$DATABASE_URL" -f database/seeds/banned-words.sql
--
-- See database/seeds/banned-words.example.sql for the shape, and 042 for the
-- same note where the second batch used to be.
--
-- Intentionally a no-op, kept so the numbering stays stable.
SELECT 1;
