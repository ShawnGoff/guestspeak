/**
 * Word filter — loads the banned word list from the DB, caches it in memory,
 * and applies regex patterns that catch common leet-speak substitutions.
 *
 * Applied at question submission time. The stored body is already cleaned —
 * no secondary pass needed on read.
 *
 * Word list is managed via the admin panel and never requires a redeploy.
 */

import { pool } from '../db/pool';

// ─── Cache ────────────────────────────────────────────────────────────────────

export interface BannedWord {
  word: string;
  /** 'word' = whole-word only; 'substring' = anywhere, after normalisation. */
  matchMode: 'word' | 'substring';
  /** Whether this word is rejected in usernames and other handles. */
  blocksHandles: boolean;
}

let cachedWords: BannedWord[] = [];
let cachedExceptions: string[] = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes

async function getWords(): Promise<BannedWord[]> {
  if (Date.now() < cacheExpiry && cachedWords.length > 0) return cachedWords;
  const result = await pool.query<{ word: string; match_mode: string; blocks_handles: boolean }>(
    'SELECT word, match_mode, blocks_handles FROM banned_words',
  );
  cachedWords = result.rows
    .map(r => ({
      word: r.word.toLowerCase().trim(),
      matchMode: (r.match_mode === 'substring' ? 'substring' : 'word') as 'word' | 'substring',
      blocksHandles: r.blocks_handles !== false,
    }))
    .filter(w => w.word.length > 0);

  const ex = await pool.query<{ phrase: string }>('SELECT phrase FROM banned_word_exceptions');
  cachedExceptions = ex.rows.map(r => normaliseHandle(r.phrase)).filter(Boolean);

  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedWords;
}

/** Call this when the admin updates the word list so the cache refreshes immediately. */
export function invalidateWordCache(): void {
  cacheExpiry = 0;
}

/**
 * Flatten a handle to the letters someone was actually trying to spell.
 *
 * Separators go, digits and symbols standing in for letters come back, and
 * repeated characters collapse. "x_X.s1uuur.99" and "slur" end up the same
 * string, which is the point: a handle is one token, so the only way to catch
 * a term buried in it is to strip the burial first.
 *
 * Only ever used for comparison — nothing stored or shown goes through this.
 */
export function normaliseHandle(text: string): string {
  const LEET: Record<string, string> = {
    '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '|': 'i',
    '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't', '9': 'g', '8': 'b',
  };
  return (text ?? '')
    .toLowerCase()
    .split('')
    .map(c => LEET[c] ?? c)
    .join('')
    // Anything that is not a letter was either decoration or a separator.
    .replace(/[^a-z]/g, '');
}

/**
 * The same string with runs of a repeated letter squeezed to one, so "sluuur"
 * reads as "slur".
 *
 * Kept apart from normaliseHandle, and applied only to the text being checked
 * — never to the banned word. Collapsing both sides looks symmetrical and is
 * a trap: "kkk" collapses to "k", and every handle containing the letter k
 * then matches. That is not hypothetical, it is what the first version of this
 * did, and it refused Hancock, Dickinson, peacock, classic_rock and
 * ren_takahashi before a test caught it.
 *
 * Both forms are checked, so "kkk88" is caught by the uncollapsed pass while
 * "sluuur" is caught by this one.
 */
export function collapseRepeats(text: string): string {
  return text.replace(/(.)\1+/g, '$1');
}

// ─── Pattern builder ──────────────────────────────────────────────────────────

/**
 * Character substitution map — covers the most common evasion attempts.
 * Each value is a character class string (no enclosing brackets — we add them below).
 */
const SUBS: Record<string, string> = {
  a: 'a@4',
  e: 'e3',
  i: 'i1!|',
  o: 'o0',
  s: 's$5',
  t: 't7+',
  u: 'uv',
  g: 'g9',
  l: 'l1',
};

/** Optional separator between characters — catches spaced-out evasions like "s l u r". */
const SEP = '[\\s._\\-*]?';

function buildPattern(word: string): RegExp {
  const chars = word
    .toLowerCase()
    .split('')
    .map(c => {
      const sub = SUBS[c];
      // Escape regex special chars for characters not in the substitution map
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return sub ? `[${sub}]` : escaped;
    });

  const body = chars.join(SEP);

  // Lookbehind/ahead — don't match mid-word (e.g. "class" shouldn't catch "ass")
  return new RegExp(`(?<![a-zA-Z0-9])${body}(?![a-zA-Z0-9])`, 'gi');
}

// ─── Replacement ──────────────────────────────────────────────────────────────

/**
 * Replaces the matched text with the first character + asterisks.
 * The asterisk count equals the canonical word length (not the match length),
 * so spacing tricks don't make the censored form look odd.
 */
function makeReplacement(canonicalLength: number) {
  return (match: string): string => {
    if (match.length === 0) return match;
    return match[0] + '*'.repeat(Math.max(canonicalLength - 1, 1));
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns a cleaned copy of `text` with all banned words asterisked out.
 * The original string is never mutated.
 */
export async function filterText(text: string): Promise<string> {
  const words = await getWords();
  if (words.length === 0) return text;

  let result = text;
  for (const { word } of words) {
    const pattern = buildPattern(word);
    const replacement = makeReplacement(word.length);
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Async validation helper for input fields (usernames, session titles, guest names).
 * Always warms the cache before checking, so it works correctly on a cold server.
 * Throws AppError 400 if the text contains a banned word.
 */
export async function rejectIfBanned(text: string): Promise<void> {
  const words = await getWords();
  const hit = words.some(({ word }) => buildPattern(word).test(text));
  if (hit) {
    const { AppError } = await import('../middleware/errorHandler');
    throw new AppError(400, 'Inappropriate language detected');
  }
}

/**
 * Validation for a handle — a username, a guest display name, a channel name.
 *
 * Distinct from rejectIfBanned because a handle is one token. The prose filter
 * anchors every pattern to word boundaries so "class" does not trip on "ass";
 * against "xXslurXx" that anchoring is what lets it through. Measured on the
 * old path, with "slur" listed: "slur" blocked, "xXslurXx", "slur99" and
 * "iamaslur" all allowed.
 *
 * So this runs two passes:
 *
 *   1. The prose pass, unchanged, which still catches whole words and the
 *      spaced-out spellings a display name can carry.
 *   2. A normalised substring pass over words marked 'substring' — separators
 *      and leet-speak flattened away, so "x_X.s1ur.99" reduces to something
 *      that contains "slur".
 *
 * The second pass is why exceptions exist. Matching a substring anywhere means
 * a term with an innocent longer word around it — the Scunthorpe problem —
 * would be refused, so a handle whose normalised form matches an exception is
 * allowed through before the substring pass runs.
 */
export async function rejectIfBannedHandle(text: string): Promise<void> {
  const words = await getWords();
  if (words.length === 0) return;

  const { AppError } = await import('../middleware/errorHandler');
  const refuse = () => {
    throw new AppError(400, 'That name is not available. Please choose another.');
  };

  const handleWords = words.filter(w => w.blocksHandles);

  // Pass 1 — the prose rules, which still hold for a display name with spaces.
  if (handleWords.some(({ word }) => buildPattern(word).test(text))) refuse();

  // Pass 2 — normalised substring, for terms with no innocent use.
  const flat = normaliseHandle(text);
  if (!flat) return;
  const squeezed = collapseRepeats(flat);
  if (cachedExceptions.some(ex => ex && (flat.includes(ex) || squeezed.includes(ex)))) return;

  const hit = handleWords.some(w => {
    if (w.matchMode !== 'substring') return false;
    // The term is never collapsed — see collapseRepeats.
    const target = normaliseHandle(w.word);
    return target.length > 0 && (flat.includes(target) || squeezed.includes(target));
  });
  if (hit) refuse();
}
