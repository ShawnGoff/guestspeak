import { resolveAsset } from '@/lib/api';

/**
 * The tile shown for a channel — its uploaded logo, or a coloured fallback.
 *
 * The fallback used to be the first letter of the name, written out in eight
 * places. That breaks precisely where it matters most: a station names its
 * shows "KGMZ Morning Drive", "KGMZ Newsroom", "KGMZ Weekend Edition", and all
 * three rendered an identical "K".
 *
 * A microphone glyph was the obvious alternative and is worse — it would make
 * every channel in the product identical rather than just the ones sharing an
 * initial, which is the opposite of what a tile in a list of six is for. The
 * microphone belongs on the upload control in channel settings, where the
 * message is "this is a channel, give it a logo" rather than "which channel is
 * this".
 *
 * So: up to two initials, on a colour derived from the slug. At 40px the colour
 * does most of the identifying and the letters settle the rest.
 */

/**
 * Eight backgrounds, each carrying white text at 4.99:1 or better.
 *
 * Amber and rose both clear contrast and are still excluded: red is what "Live"
 * means everywhere else in the product, and orange is the CTA colour. A channel
 * tile in either would read as a status or a highlight rather than an identity.
 *
 * Spread across the hues that remain rather than bunched. A first attempt held
 * indigo, teal, cyan, emerald and blue — five neighbours out of eight — and on
 * nine real channels it produced three teals and never reached indigo, fuchsia
 * or slate at all.
 */
const PALETTE = [
  '#1D4ED8', // blue
  '#0369A1', // sky
  '#0F766E', // teal
  '#047857', // emerald
  '#4D7C0F', // lime
  '#7C3AED', // violet
  '#A21CAF', // fuchsia
  '#475569', // slate
];

/** Words that are never the identifying part of a name. */
const SKIP = new Set(['the', 'a', 'an', 'of', 'and']);

/**
 * Up to two initials.
 *
 *   KGMZ Morning Drive        → KM
 *   KGMZ 104.7 Morning Drive  → KM   (a token starting with a digit is skipped;
 *                                     "K1" identifies nothing)
 *   The Midnight Hour         → MH   (article dropped)
 *   StackConf                 → S    (one word gets one letter; "SC" would read
 *                                     as an acronym the name does not have)
 *   dana_ruiz                 → DR   (underscores separate words too)
 */
export function initialsFor(name: string): string {
  const words = (name ?? '')
    .split(/[\s_\-–—]+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(w => w.length > 0 && /^\p{L}/u.test(w) && !SKIP.has(w.toLowerCase()));

  // No letters at all — an emoji-only or numeric name. Signalled with '' so
  // the component can draw a microphone, which beats a literal question mark.
  if (words.length === 0) return '';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Stable colour for a channel. Keyed on the slug rather than the name so
 * renaming a show does not change the colour its audience recognises.
 */
export function colourFor(seed: string): string {
  // FNV-1a. `hash * 31 + char` was the obvious choice and the wrong one here:
  // channel slugs from one station share a prefix ("kgmz-morning-drive",
  // "kgmz-newsroom"), and it mapped those neighbours onto neighbouring buckets.
  // Measured over the same nine slugs, this reaches six of the eight colours
  // where that reached five, and its worst collision is two rather than three.
  let hash = 0x811c9dc5;
  const s = seed ?? '';
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length];
}

export default function ChannelAvatar({
  name, seed, src, className = '', textClassName = '',
}: {
  name: string;
  /** Slug or username — whatever is stable for this channel. */
  seed: string;
  src?: string | null;
  /** Sets the box: width, height and corner radius. */
  className?: string;
  /** Sets the letters: font size and weight. */
  textClassName?: string;
}) {
  if (src) {
    return (
      <img
        src={resolveAsset(src) ?? undefined}
        alt={name}
        className={`object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  const initials = initialsFor(name);

  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ backgroundColor: colourFor(seed) }}
      // The letters are decoration over the name, which is always beside it.
      aria-hidden
    >
      {initials
        ? (
          <span className={`font-bold text-white leading-none ${textClassName}`}>
            {initials}
          </span>
        )
        : (
          // Nothing letter-like to work with — an emoji-only or numeric name.
          // Here the microphone earns its place: it says "channel" where there
          // is no identity to show, rather than replacing one that exists.
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round"
               className="w-1/2 h-1/2 text-white/90">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
        )}
    </div>
  );
}
