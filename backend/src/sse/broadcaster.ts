import { Response } from 'express';

export type SSEEventType =
  | 'question:new'
  | 'question:updated'
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
}

/** Map of sessionId → set of active SSE client entries */
const clients = new Map<string, Set<ClientEntry>>();

export function addClient(
  sessionId: string,
  res: Response,
  userId?: string,
  guestToken?: string,
) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId)!.add({ res, userId, guestToken });
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

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

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

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

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
