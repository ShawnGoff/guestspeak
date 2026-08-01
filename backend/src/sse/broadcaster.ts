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

/** Map of sessionId → set of active SSE response streams */
const clients = new Map<string, Set<Response>>();

export function addClient(sessionId: string, res: Response) {
  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  clients.get(sessionId)!.add(res);
}

export function removeClient(sessionId: string, res: Response) {
  clients.get(sessionId)?.delete(res);
  if (clients.get(sessionId)?.size === 0) clients.delete(sessionId);
}

export function broadcast(sessionId: string, event: SSEEvent) {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients) return;

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

  for (const res of sessionClients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected mid-write; will be cleaned up by 'close' handler
      sessionClients.delete(res);
    }
  }
}

export function clientCount(sessionId: string): number {
  return clients.get(sessionId)?.size ?? 0;
}
