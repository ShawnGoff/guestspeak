/**
 * Cross-replica event bus for SSE.
 *
 * SSE connections are held in memory by whichever replica the client happened to
 * reach. A question posted on replica A must therefore reach the sockets held by
 * replica B, or half a room silently stops receiving updates — no error, no log
 * line, the feed just goes quiet for some of the audience.
 *
 * Redis pub/sub carries events between replicas. Every replica subscribes; every
 * broadcast is published rather than written directly, and each replica delivers
 * to its own connected clients when the message comes back around.
 *
 * The publisher does NOT also deliver locally. Redis echoes a publish back to
 * the publishing subscriber, so delivering locally as well would double every
 * event for exactly the clients attached to the replica that handled the write.
 * Going through the bus in all cases also means every replica applies identical
 * delivery logic, rather than one path for "local" and another for "remote".
 *
 * Without REDIS_URL the bus short-circuits to direct local delivery, which is
 * exactly the previous single-instance behaviour. Local development and the test
 * suites need no Redis, and a single-replica deployment still works unchanged.
 */

import Redis from 'ioredis';

/** One channel for everything. Replicas ignore sessions they hold no clients for. */
const CHANNEL = 'guestspeak:sse';

const REDIS_URL = process.env.REDIS_URL ?? '';
export const busEnabled = Boolean(REDIS_URL);

/** How a message should be delivered once it reaches a replica. */
export type BusMessage =
  | { mode: 'all'; sessionId: string; event: unknown }
  | { mode: 'elevated'; sessionId: string; event: unknown }
  | { mode: 'byRole'; sessionId: string; event: unknown; audienceEvent: unknown }
  | {
      mode: 'direct';
      sessionId: string;
      event: unknown;
      userId: string | null;
      guestToken: string | null;
    };

type Handler = (msg: BusMessage) => void;

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let handler: Handler | null = null;

/**
 * Wire the bus up to a delivery function and start listening.
 * Safe to call once at startup; a no-op when REDIS_URL is unset.
 */
export function initBus(onMessage: Handler): void {
  handler = onMessage;
  if (!busEnabled) {
    console.warn(
      '[bus] REDIS_URL not set — SSE events stay within this process. ' +
      'This is correct for a single instance; running more than one replica ' +
      'without Redis silently breaks live updates for part of every audience.',
    );
    return;
  }

  // Two connections: a subscriber cannot issue ordinary commands, so publishing
  // needs its own.
  publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });

  for (const [name, conn] of [['publisher', publisher], ['subscriber', subscriber]] as const) {
    // ioredis reconnects on its own; log so an outage is visible rather than
    // presenting later as mysteriously missing events.
    conn.on('error', (err) => console.error(`[bus] ${name} error:`, err.message));
    conn.on('end', () => console.warn(`[bus] ${name} connection closed`));
    conn.on('reconnecting', () => console.warn(`[bus] ${name} reconnecting…`));
  }

  subscriber.subscribe(CHANNEL, (err) => {
    if (err) console.error('[bus] subscribe failed:', err.message);
    else console.log(`[bus] subscribed to ${CHANNEL} — SSE events span replicas`);
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      handler?.(JSON.parse(raw) as BusMessage);
    } catch (err) {
      console.error('[bus] could not handle message:', err);
    }
  });
}

/**
 * Send a message to every replica, including this one.
 *
 * Falls back to delivering directly when Redis is not configured, and also when
 * a publish fails — a broken bus should degrade to the clients on this replica
 * rather than dropping the event entirely.
 */
export function publish(msg: BusMessage): void {
  if (!busEnabled || !publisher) {
    handler?.(msg);
    return;
  }

  publisher.publish(CHANNEL, JSON.stringify(msg)).catch((err) => {
    console.error('[bus] publish failed, delivering locally only:', err.message);
    handler?.(msg);
  });
}

/** Close connections. Used by tests; production exits the process. */
export async function closeBus(): Promise<void> {
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
}
