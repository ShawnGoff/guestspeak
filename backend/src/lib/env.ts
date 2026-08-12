/**
 * Numeric environment variables, read safely.
 *
 * `parseInt(process.env.X ?? '50', 10)` looks fine and is not. The `??` only
 * covers an unset variable — an empty or misspelt value ("", "5o0", "500 ")
 * parses to NaN and sails straight into the config it feeds. A NaN connection
 * pool size or cache TTL fails in ways that are very hard to trace back to a
 * typo in a dashboard.
 *
 * These are read at boot, so a bad value is worth complaining about loudly and
 * then carrying on with the default rather than refusing to start.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    console.warn(
      `[env] ${name}="${raw}" is not an integer — falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}

/**
 * Like envInt, but rejects values below `min`. Used where zero or a negative
 * would be actively harmful rather than merely odd — a pool of 0 connections
 * accepts no work at all.
 */
export function envIntMin(name: string, fallback: number, min: number): number {
  const value = envInt(name, fallback);
  if (value < min) {
    console.warn(
      `[env] ${name}=${value} is below the minimum of ${min} — using ${fallback}.`,
    );
    return fallback;
  }
  return value;
}
