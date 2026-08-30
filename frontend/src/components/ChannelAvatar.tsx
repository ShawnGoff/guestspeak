import { resolveAsset } from '@/lib/api';

/**
 * The tile shown for a channel — its uploaded logo, or a wordmark fallback.
 *
 * The fallback used to be the first letter of the name, written out in eight
 * places. That breaks precisely where it matters most: a station names its
 * shows "KGMZ Morning Drive", "KGMZ Newsroom", "KGMZ Weekend Edition", and all
 * three rendered an identical "K".
 *
 * So: up to two initials, set the way the GuestSpeak wordmark is — first letter
 * white, second orange. That ties every channel back to the product it is on
 * while the letters themselves do the identifying.
 *
 * A microphone appears only when a name yields no letters at all. As the
 * general fallback it would be worse than the single letter it replaced,
 * making every channel identical rather than just the ones sharing an initial.
 */

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
  if (words.length === 1) {
    const w = words[0];
    // One word still wants two letters, so the second can carry the accent.
    // camelCase first — StackConf is SC, GuestSpeak is GS — then fall back to
    // the first two characters.
    const camel = w.match(/^(\p{Lu}?\p{Ll}+)(\p{Lu})/u);
    if (camel) return (camel[1][0] + camel[2]).toUpperCase();
    return w.length > 1 ? w.slice(0, 2).toUpperCase() : w[0].toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function ChannelAvatar({
  name, src, className = '', textClassName = '',
}: {
  name: string;
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
      className={`flex items-center justify-center flex-shrink-0 bg-brand-card border border-brand-border ${className}`}
      // The letters are decoration over the name, which is always beside it.
      aria-hidden
    >
      {initials
        ? (
          <span className={`font-bold leading-none ${textClassName}`}>
            <span className="text-white">{initials[0]}</span>
            {initials[1] && <span className="text-brand-orange">{initials[1]}</span>}
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
