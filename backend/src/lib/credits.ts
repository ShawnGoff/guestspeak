/**
 * The credit economy's constants and the one write that spends from it.
 *
 * These lived in sessionController, where the heartbeat needed them, while the
 * spend paths lived in questionController and could not see them. Keeping them
 * apart is what let the regen clock and the spend disagree.
 */

import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';

/** Guests get at most this many regen credits for the whole session, then must sign up. */
export const GUEST_REGEN_LIMIT = 2;
/** …and regeneration never takes a guest above this ceiling. */
export const GUEST_CREDIT_CAP = 2;
/** Signed-in users regenerate up to this ceiling, with no lifetime limit. */
export const USER_CREDIT_CAP = 6;
/** Minutes between regeneration ticks. */
export const CREDIT_REGEN_MINUTES = 10;

/** The ceiling regeneration refills this caller toward, before the host's own limit. */
export function tierCap(isGuest: boolean): number {
  return isGuest ? GUEST_CREDIT_CAP : USER_CREDIT_CAP;
}

/** Minimal shape shared by `pool` and a checked-out client, so a spend can join a transaction. */
interface Queryable {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number | null; rows: unknown[] }>;
}

/**
 * Atomically spend one credit. Throws 402 when the caller has none.
 *
 * Also starts the regeneration clock, and that is the subtle half. The clock
 * falls back to joined_at until the first credit is granted, which is right for
 * someone who spends straight away and wrong for someone who does not: sit at
 * the ceiling for longer than the interval, spend everything, and the fallback
 * is already stale, so the next heartbeat hands a credit straight back. Waiting
 * while you have nothing to regenerate toward is not waiting for a refill.
 *
 * So the clock starts the moment the balance first drops below the ceiling
 * regeneration actually refills to — the moment a refill becomes owed. Not on
 * any spend: a guest holding the host's full six is nowhere near the guest
 * ceiling of two, and starting the clock there would let them run it down
 * while still spending, arriving at the ceiling with the wait already served.
 *
 * Pass `client` to run inside an existing transaction.
 */
export async function spendCredit(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
  client: Queryable = pool,
): Promise<number> {
  const col = userId ? 'user_id' : 'guest_token';
  const val = userId ?? guestToken;
  const cap = tierCap(!userId);

  const result = await client.query(
    `UPDATE session_participants p
        SET credits_remaining = p.credits_remaining - 1,
            actions_used      = p.actions_used + 1,
            last_credit_at    = CASE
              WHEN p.last_credit_at IS NULL
               AND p.credits_remaining - 1 < LEAST($3, s.credits_per_user)
              THEN NOW()
              ELSE p.last_credit_at
            END
       FROM sessions s
      WHERE s.id = p.session_id
        AND p.session_id = $1
        AND p.${col} = $2
        AND p.credits_remaining > 0
    RETURNING p.credits_remaining`,
    [sessionId, val, cap],
  );

  if (result.rowCount === 0) throw new AppError(402, 'No credits remaining');
  return (result.rows[0] as { credits_remaining: number }).credits_remaining;
}
