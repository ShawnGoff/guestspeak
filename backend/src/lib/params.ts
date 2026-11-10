/**
 * Query-string numbers, read safely.
 *
 * `parseInt(x) || default` looks defensive and is not: "-1" is truthy, so a
 * negative limit or offset went straight into SQL, where Postgres rejects it
 * and the caller got a 500 for their own typo. Every route taking a paging or
 * coordinate parameter goes through these instead.
 */
export function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** A finite number within [min, max], or null if absent or invalid. */
export function floatParam(raw: unknown, min: number, max: number): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
