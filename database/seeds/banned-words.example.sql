-- The shape of the blocklist, with harmless stand-ins for the real terms.
--
-- Copy this to banned-words.sql, replace the examples with a real list, and
-- apply it:
--
--   cp database/seeds/banned-words.example.sql database/seeds/banned-words.sql
--   # edit it
--   psql "$DATABASE_URL" -f database/seeds/banned-words.sql
--
-- banned-words.sql is gitignored. A database with no seed applied has an empty
-- blocklist and refuses nothing, so apply one before taking signups.
--
-- The maintained list at github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-
-- Otherwise-Bad-Words is the usual starting point, and the admin panel can add
-- terms without a deploy.

-- ── The two match modes ──────────────────────────────────────────────────────
--
-- 'substring' is the strong one: matched anywhere in a handle after separators
-- and leet-speak are flattened, so "xXtermXx", "t3rm" and "t.e.r.m" are all
-- caught. Reserve it for terms with no innocent use, because matching anywhere
-- is also what refuses Scunthorpe.
--
-- 'word' is whole-word only, for profanity that real words contain. The
-- trade-off is deliberate and documented in 045: "shit" stays whole-word so
-- that "mishit" and "shiitake" survive, which means "shitass" gets through.
-- Closing that costs real people their names, and that is the worse failure.
--
-- Check a candidate against a dictionary before choosing 'substring':
--
--   grep -c "term" /usr/share/dict/words
--
-- Any hit at all means it has an innocent host word. Use 'word'.
--
-- blocks_handles is true throughout here: a username that *is* the word is
-- refused either way; the mode only decides whether it is caught inside a
-- longer handle.

INSERT INTO banned_words (word, match_mode, blocks_handles) VALUES
  -- substring: no innocent use, caught anywhere
  ('examplesluronE',  'substring', true),
  ('examplesluronTwo','substring', true),

  -- word: has innocent host words, so whole-word only
  ('damn',  'word', true),
  ('crap',  'word', true)
ON CONFLICT (word) DO NOTHING;

-- ── Exceptions ───────────────────────────────────────────────────────────────
--
-- A handle matching one of these skips the substring pass entirely, so keep the
-- list short and specific. It exists because matching anywhere refuses real
-- names: "porn" is banned as a substring and sits inside a large family of Thai
-- given names built on พร (phon, "blessing") — Pornchai, Siriporn, Supaporn.
-- Someone reporting that their own name is refused is a bug report, not a
-- borderline call.
--
-- Note the cost: allowing "siriporn" also allows "siriporn<slur>", with only
-- the whole-word pass still standing against it.

INSERT INTO banned_word_exceptions (phrase) VALUES
  ('allspice'),
  ('scunthorpe')
ON CONFLICT DO NOTHING;
