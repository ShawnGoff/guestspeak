-- A starting blocklist, so the filter is not empty on the day it is needed.
--
-- Two categories, matched differently:
--
--   substring — slurs and hardcore sexual terms. No innocent use, so they are
--               caught anywhere in a handle after normalisation, which is what
--               stops "xXtermXx" and "term99".
--   word      — general profanity. Real words often contain these, so they are
--               whole-word only; blocks_handles is still true, so a username
--               that *is* the word is refused while "Scunthorpe" survives.
--
-- Deliberately not exhaustive, and it should not stay this size. A hand-written
-- list will always trail the ways people work around it, and slurs vary by
-- region and community in ways this does not cover. Treat it as the floor.
-- The maintained list at github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-
-- Otherwise-Bad-Words is the usual starting point for a fuller import, and the
-- admin panel can add terms without a deploy.
--
-- ON CONFLICT DO NOTHING throughout: this migration is additive and must not
-- disturb anything already curated in production.

-- ── Sexual, matched anywhere in a handle ─────────────────────────────────────
INSERT INTO banned_words (word, match_mode, blocks_handles) VALUES
  ('anal',        'substring', TRUE),
  ('blowjob',     'substring', TRUE),
  ('bukkake',     'substring', TRUE),
  ('cocksucker',  'substring', TRUE),
  ('creampie',    'substring', TRUE),
  ('cumshot',     'substring', TRUE),
  ('cunnilingus', 'substring', TRUE),
  ('deepthroat',  'substring', TRUE),
  ('dildo',       'substring', TRUE),
  ('ejaculate',   'substring', TRUE),
  ('felching',    'substring', TRUE),
  ('fellatio',    'substring', TRUE),
  ('fisting',     'substring', TRUE),
  ('gangbang',    'substring', TRUE),
  ('handjob',     'substring', TRUE),
  ('hentai',      'substring', TRUE),
  ('jizz',        'substring', TRUE),
  ('masturbat',   'substring', TRUE),
  ('milf',        'substring', TRUE),
  ('nutsack',     'substring', TRUE),
  ('pedo',        'substring', TRUE),
  ('porn',        'substring', TRUE),
  ('rimjob',      'substring', TRUE),
  ('scat',        'substring', TRUE),
  ('titties',     'substring', TRUE),
  ('upskirt',     'substring', TRUE)
ON CONFLICT (word) DO NOTHING;

-- ── Slurs, matched anywhere in a handle ──────────────────────────────────────
-- Racial, ethnic, religious, homophobic, transphobic and ableist. Written in
-- full because a blocklist that does not contain the string cannot match it.
INSERT INTO banned_words (word, match_mode, blocks_handles) VALUES
  ('nigger',      'substring', TRUE),
  ('nigga',       'substring', TRUE),
  ('chink',       'substring', TRUE),
  ('gook',        'substring', TRUE),
  ('spic',        'substring', TRUE),
  ('wetback',     'substring', TRUE),
  ('beaner',      'substring', TRUE),
  ('kike',        'substring', TRUE),
  ('heeb',        'substring', TRUE),
  ('raghead',     'substring', TRUE),
  ('towelhead',   'substring', TRUE),
  ('sandnigger',  'substring', TRUE),
  ('gypsy',       'word',      TRUE),
  ('paki',        'substring', TRUE),
  ('coon',        'substring', TRUE),
  ('jigaboo',     'substring', TRUE),
  ('darkie',      'substring', TRUE),
  ('faggot',      'substring', TRUE),
  ('fag',         'word',      TRUE),
  ('dyke',        'word',      TRUE),
  ('tranny',      'substring', TRUE),
  ('shemale',     'substring', TRUE),
  ('ladyboy',     'substring', TRUE),
  ('retard',      'substring', TRUE),
  ('spastic',     'substring', TRUE),
  ('mongoloid',   'substring', TRUE),
  ('cripple',     'word',      TRUE),
  ('hitler',      'substring', TRUE),
  ('nazi',        'substring', TRUE),
  ('kkk',         'substring', TRUE),
  ('whitepower',  'substring', TRUE),
  ('heilhitler',  'substring', TRUE)
ON CONFLICT (word) DO NOTHING;

-- ── General profanity, whole word only ───────────────────────────────────────
-- Real words contain these. "assassin", "Scunthorpe", "Cockburn", "Hancock",
-- "analysis", "Dickinson", "Essex", "Sussex", "Middlesex", "shiitake",
-- "Lightwater", "Penistone", "cocktail", "peacock", "titmouse". Whole-word
-- matching is what keeps them working, and it is why these are not 'substring'.
INSERT INTO banned_words (word, match_mode, blocks_handles) VALUES
  ('fuck',        'word', TRUE),
  ('fucker',      'word', TRUE),
  ('motherfucker','word', TRUE),
  ('shit',        'word', TRUE),
  ('bullshit',    'word', TRUE),
  ('bitch',       'word', TRUE),
  ('cunt',        'word', TRUE),
  ('cock',        'word', TRUE),
  ('dick',        'word', TRUE),
  ('prick',       'word', TRUE),
  ('pussy',       'word', TRUE),
  ('twat',        'word', TRUE),
  ('wanker',      'word', TRUE),
  ('bastard',     'word', TRUE),
  ('whore',       'word', TRUE),
  ('slut',        'word', TRUE),
  ('asshole',     'word', TRUE),
  ('arsehole',    'word', TRUE),
  ('douchebag',   'word', TRUE),
  ('boner',       'word', TRUE),
  ('tits',        'word', TRUE)
ON CONFLICT (word) DO NOTHING;

-- ── Exceptions ───────────────────────────────────────────────────────────────
-- Legitimate strings whose normalised form contains a substring term. Checked
-- before the substring pass, because that pass has no notion of word edges.
-- These are stored normalised-insensitive; the filter normalises both sides.
INSERT INTO banned_word_exceptions (phrase, note) VALUES
  ('analysis',    'contains anal'),
  ('analyst',     'contains anal'),
  ('analytics',   'contains anal'),
  ('analog',      'contains anal'),
  ('canal',       'contains anal'),
  ('banal',       'contains anal'),
  ('scatter',     'contains scat'),
  ('scattered',   'contains scat'),
  ('scathing',    'contains scat'),
  ('cathedral',   'contains scat when normalised'),
  ('scatterbrain','contains scat'),
  ('raccoon',     'contains coon'),
  ('cocoon',      'contains coon'),
  ('tycoon',      'contains coon'),
  ('lagoon',      'contains coon when normalised'),
  ('spicy',       'contains spic'),
  ('auspicious',  'contains spic'),
  ('suspicious',  'contains spic'),
  ('despicable',  'contains spic'),
  ('conspicuous', 'contains spic'),
  ('scatology',   'contains scat')
ON CONFLICT (phrase) DO NOTHING;
