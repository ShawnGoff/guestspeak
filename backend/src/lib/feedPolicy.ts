/**
 * How a session's audience follows the question feed.
 *
 * Per-event SSE fan-out costs one socket write per connected client per event,
 * in a single process. That is the right trade for a room of fifty and the wrong
 * one for a stadium, where one echo would mean tens of thousands of writes.
 * Past the threshold the audience polls a short-TTL cached feed instead, which
 * turns unbounded fan-out into a fixed cost per interval.
 *
 * Hosts and moderators always keep the live stream regardless of session size —
 * there are only ever a handful of them and they are the ones who need
 * immediacy.
 *
 * Shared between getSession (which advertises feed_mode to the client) and the
 * SSE route (which enforces it). Keeping the numbers in one place matters: if
 * the two disagree, clients are told to poll while the stream still accepts
 * them, or told to stream while it refuses them.
 */

// envIntMin, not parseInt. lib/env.ts was written to stop exactly this, and
// quotes this shape in its own doc comment: `parseInt(process.env.X ?? '50')`
// only covers an unset variable, so a blank or misspelt one ("", "4OO", "400 ")
// parses to NaN and sails into the config it feeds.
//
// NaN here is quiet and strange rather than loud. Every comparison against it
// is false, so a session would be told to poll while the stream still accepted
// it, or to stream while the stream refused it — the exact disagreement the
// comment above says this file exists to prevent.
import { envIntMin } from './env';

export const LIVE_FEED_MAX_PARTICIPANTS = envIntMin('LIVE_FEED_MAX_PARTICIPANTS', 400, 1);

// A poll interval of zero is a client hammering the API as fast as it can
// answer, so the floor is a second rather than one.
export const FEED_POLL_INTERVAL_MS = envIntMin('FEED_POLL_INTERVAL_MS', 5000, 1000);

export type FeedMode = 'live' | 'polling';

/**
 * Elevated callers always stream. Everyone else streams only while the session
 * is small enough for fan-out to be affordable.
 */
export function feedModeFor(participantCount: number, isElevated: boolean): FeedMode {
  if (isElevated) return 'live';
  return participantCount <= LIVE_FEED_MAX_PARTICIPANTS ? 'live' : 'polling';
}
