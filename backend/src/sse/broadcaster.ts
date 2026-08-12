import { Response } from 'express';
import { initBus, publish, type BusMessage } from './bus';

export type SSEEventType =
  | 'question:new'
  | 'question:pending'
  | 'question:updated'
  | 'question:removed'
  | 'echo:added'
  | 'session:live'
  | 'session:closed'
  | 'session:spotlight'
  | 'participant:count'
  | 'participant:muted'
  | 'participant:removed';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

interface ClientEntry {
  res: Response;
  /** Set for registered (non-guest) users */
  userId?: string;
  /** Set for guest users */
  guestToken?: string;
  /** Host, org owner/admin, or assigned moderator on this session */
  elevated: boolean;
}

/**
 * Map of sessionId → the SSE clients connected to THIS replica.
 *
 * Process-local by nature: an open socket belongs to whichever process is
 * holding it. What used to make that a single-instance constraint was sending
 * directly to this Map; sends now go through the bus (see ./bus), so every
 * replica receives every event and writes to whichever sockets it happens to
 * hold. Set REDIS_URL before raising the replica count.
 */
const clients = new Map<string, Set<ClientEntry>>();

export function addClient(
  sessionId: string,
  res: Response,
  userId?: string,
  guestToken?: string,
  elevated = false,
) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId)!.add({ res, userId, guestToken, elevated });
}

export function removeClient(sessionId: string, res: Response) {
  const set = clients.get(sessionId);
  if (!set) return;
  for (const entry of set) {
    if (entry.res === res) { set.delete(entry); break; }
  }
  if (set.size === 0) clients.delete(sessionId);
}

// ─── Sending ─────────────────────────────────────────────────────────────────
//
// Every send publishes to the bus rather than writing to sockets directly, and
// delivery happens when the message comes back from the bus. With Redis
// configured that reaches all replicas; without it the bus calls straight
// through and behaviour is identical to before.

/** Send an event to every connected client in the session. */
export function broadcast(sessionId: string, event: SSEEvent) {
  publish({ mode: 'all', sessionId, event });
}

/**
 * Send one event to hosts/moderators and a different one to everyone else.
 *
 * Used when moderating content: hiding a question must not push its body to
 * every connected browser. Mods get the full updated question so their panel
 * stays in sync; the audience gets a bare removal notice.
 */
export function broadcastByRole(
  sessionId: string,
  elevatedEvent: SSEEvent,
  audienceEvent: SSEEvent,
) {
  publish({ mode: 'byRole', sessionId, event: elevatedEvent, audienceEvent });
}

/**
 * Send an event only to hosts/moderators, with nothing sent to the audience.
 *
 * Used for the approval queue: a pending question must reach the people who can
 * approve it, live, without being shown to the room before it is approved.
 */
export function broadcastElevated(sessionId: string, event: SSEEvent) {
  publish({ mode: 'elevated', sessionId, event });
}

/**
 * Send an event only to the specific participant identified by userId or
 * guestToken. Used for moderation events (mute, remove) that should not be
 * visible to other attendees.
 */
export function broadcastTo(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
  event: SSEEvent,
) {
  publish({ mode: 'direct', sessionId, event, userId, guestToken });
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/**
 * Write a bus message to this replica's own sockets.
 *
 * The only place events reach clients. A replica holding no clients for the
 * session drops the message, which is the common case once several replicas
 * are running.
 */
function deliver(msg: BusMessage): void {
  const set = clients.get(msg.sessionId);
  if (!set) return;

  const primary = encode(msg.event as SSEEvent);
  const audience = msg.mode === 'byRole' ? encode(msg.audienceEvent as SSEEvent) : null;

  for (const entry of set) {
    let payload: string | null = null;

    switch (msg.mode) {
      case 'all':
        payload = primary;
        break;
      case 'elevated':
        payload = entry.elevated ? primary : null;
        break;
      case 'byRole':
        payload = entry.elevated ? primary : audience;
        break;
      case 'direct':
        payload =
          (msg.userId && entry.userId === msg.userId) ||
          (msg.guestToken && entry.guestToken === msg.guestToken)
            ? primary
            : null;
        break;
    }

    if (!payload) continue;
    try {
      entry.res.write(payload);
    } catch {
      // Client disconnected mid-write; the 'close' handler also cleans up.
      set.delete(entry);
    }
  }
}

function encode(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

// Start listening as soon as this module loads, so events arriving from other
// replicas have somewhere to go before the first client connects.
initBus(deliver);

export function clientCount(sessionId: string): number {
  return clients.get(sessionId)?.size ?? 0;
}
