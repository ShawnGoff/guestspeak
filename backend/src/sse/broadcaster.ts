import { Response } from 'express';

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
 * Map of sessionId → set of active SSE client entries.
 *
 * ⚠️  THIS IS PROCESS-LOCAL. The backend must run as a SINGLE instance.
 *
 * With two or more replicas, a question posted on replica A is broadcast only
 * to the clients holding an SSE connection to replica A — everyone connected to
 * replica B sees nothing until they refresh. There is no error, no log line, and
 * nothing in the UI: the feed just silently stops being live for a fraction of
 * the audience, which is the worst possible failure mode during a live session.
 *
 * Before scaling the backend horizontally, this Map has to move behind a shared
 * pub/sub (Redis) so every replica receives every event. Until then, keep
 * Railway's replica count at 1. See DEPLOY.md → "Scaling limits".
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

/** Send an event to every connected client in the session. */
export function broadcast(sessionId: string, event: SSEEvent) {
  const set = clients.get(sessionId);
  if (!set) return;

  const payload = encode(event);

  for (const entry of set) {
    try {
      entry.res.write(payload);
    } catch {
      // Client disconnected mid-write; will be cleaned up by 'close' handler
      set.delete(entry);
    }
  }
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
  const set = clients.get(sessionId);
  if (!set) return;

  const elevatedPayload = encode(elevatedEvent);
  const audiencePayload = encode(audienceEvent);

  for (const entry of set) {
    try {
      entry.res.write(entry.elevated ? elevatedPayload : audiencePayload);
    } catch {
      set.delete(entry);
    }
  }
}

/**
 * Send an event only to hosts/moderators, with nothing sent to the audience.
 *
 * Used for the approval queue: a pending question must reach the people who can
 * approve it, live, without being shown to the room before it is approved.
 */
export function broadcastElevated(sessionId: string, event: SSEEvent) {
  const set = clients.get(sessionId);
  if (!set) return;

  const payload = encode(event);

  for (const entry of set) {
    if (!entry.elevated) continue;
    try {
      entry.res.write(payload);
    } catch {
      set.delete(entry);
    }
  }
}

function encode(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * Send an event only to the specific participant identified by userId or guestToken.
 * Use this for moderation events (mute, remove) that should not be visible to
 * other attendees.
 */
export function broadcastTo(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
  event: SSEEvent,
) {
  const set = clients.get(sessionId);
  if (!set) return;

  const payload = encode(event);

  for (const entry of set) {
    const matches =
      (userId && entry.userId === userId) ||
      (guestToken && entry.guestToken === guestToken);
    if (!matches) continue;
    try {
      entry.res.write(payload);
    } catch {
      set.delete(entry);
    }
  }
}

export function clientCount(sessionId: string): number {
  return clients.get(sessionId)?.size ?? 0;
}
