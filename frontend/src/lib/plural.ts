/**
 * Count with a correctly pluralised noun.
 *
 * Nine places wrote `{n} echoes` / `{n} questions` straight into the markup, so
 * a session with one of anything read "1 echoes". Small, but it is on the
 * busiest surface in the product and it reads as sloppiness.
 *
 *   plural(1, 'echo')            → '1 echo'
 *   plural(3, 'echo')            → '3 echoes'   (irregular, so pass it)
 *   plural(0, 'question')        → '0 questions'
 *   plural(1, 'reply', 'replies')→ '1 reply'
 */
export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`;
}
