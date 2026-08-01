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

let cachedWords: string[] = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes

async function getWords(): Promise<string[]> {
  if (Date.now() < cacheExpiry && cachedWords.length > 0) return cachedWords;
  const result = await pool.query<{ word: string }>('SELECT word FROM banned_words');
  cachedWords = result.rows.map(r => r.word.toLowerCase().trim()).filter(Boolean);
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedWords;
}

/** Call this when the admin updates the word list so the cache refreshes immediately. */
export function invalidateWordCache(): void {
  cacheExpiry = 0;
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
  for (const word of words) {
    const pattern = buildPattern(word);
    const replacement = makeReplacement(word.length);
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Synchronous check — returns true if text contains any banned word.
 * Uses the cached list; if cache is cold it returns false (safe default).
 * Useful for validation layers that can't await.
 */
export function containsBannedWord(text: string): boolean {
  if (cachedWords.length === 0) return false;
  return cachedWords.some(word => buildPattern(word).test(text));
}
