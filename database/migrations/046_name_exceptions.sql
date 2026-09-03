-- Names and words the substring filter was refusing.
--
-- "porn" is banned as a substring, which is right, and it sits inside a large
-- family of Thai given names: พร (phon, "blessing") transliterates as "porn"
-- and appears as a prefix or suffix in very common names. Pornchai and Siriporn
-- are not edge cases — they are somebody's actual name, and the product was
-- telling them to pick a different one.
--
-- "spic" catches allspice for the same reason.
--
-- This is a list, not a rule, and it will be incomplete. There is no way to
-- express "porn as a Thai name syllable but not otherwise" in a substring
-- filter, and adding "porn" itself as an exception would delete the ban. So
-- these are the common transliterations; expect to add more when someone
-- reports being refused, and treat such a report as a bug rather than a
-- borderline call.
--
-- Note what an exception costs. A handle matching one skips the whole substring
-- pass, so "siriporn" allowed through means "siriporn<slur>" is allowed too —
-- only the whole-word pass still applies to it. That is the existing design and
-- the reason this list is kept short and specific rather than generous.
INSERT INTO banned_word_exceptions (phrase) VALUES
  -- พร as a prefix
  ('pornchai'), ('pornthip'), ('porntip'), ('pornsak'),
  ('pornpimol'), ('pornrat'), ('pornwipa'),
  -- พร as a suffix
  ('siriporn'), ('supaporn'), ('kanokporn'), ('nipaporn'),
  ('duangporn'), ('sudaporn'), ('thanaporn'), ('jiraporn'),
  ('sasiporn'), ('chutiporn'), ('wanaporn'), ('suporn'),
  -- the spice
  ('allspice')
ON CONFLICT DO NOTHING;
