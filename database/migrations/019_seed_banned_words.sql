-- Seed banned_words table with baseline slurs
-- Scope: racial, ethnic, homophobic, and transphobic slurs only.
-- General profanity is excluded (context-dependent, rabbit hole).
-- Common letter substitutions are handled at query time by the word filter logic,
-- so we store the base forms here.

INSERT INTO banned_words (word) VALUES
  -- Racial / ethnic slurs
  ('nigger'),
  ('nigga'),
  ('chink'),
  ('gook'),
  ('spic'),
  ('spick'),
  ('wetback'),
  ('beaner'),
  ('kike'),
  ('hymie'),
  ('raghead'),
  ('towelhead'),
  ('camel jockey'),
  ('sand nigger'),
  ('paki'),
  ('coon'),
  ('jigaboo'),
  ('jungle bunny'),
  ('porchmonkey'),
  ('zipperhead'),
  ('slope'),
  ('nip'),
  ('kraut'),
  ('greaseball'),
  ('wop'),
  ('dago'),
  ('guinea'),
  ('polack'),
  ('redskin'),
  ('squaw'),
  ('half-breed'),
  ('mulatto'),
  -- Homophobic / transphobic slurs
  ('faggot'),
  ('fag'),
  ('dyke'),
  ('tranny'),
  ('shemale'),
  ('heshe'),
  ('troon'),
  ('sodomite'),
  -- Ableist slurs
  ('retard'),
  ('retarded'),
  ('spaz'),
  -- General hate
  ('subhuman'),
  ('vermin')
ON CONFLICT (word) DO NOTHING;
