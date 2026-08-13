import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({ error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request' });
    return;
  }

  // Malformed JSON in the request body. express.json() raises a SyntaxError,
  // which otherwise falls through to the 500 below — reporting a client mistake
  // as a server fault. That matters beyond the status code: once errors are
  // forwarded to a monitoring service, anyone sending junk to the API would
  // raise alerts about a server that is working correctly.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Malformed JSON in request body' });
    return;
  }

  // PostgreSQL 22P02 (invalid_text_representation): a value could not be parsed
  // as its column type — most often a path or query parameter that is not a
  // valid UUID. The caller sent something malformed, so it is a 400.
  //
  // Handled centrally rather than by validating an id in every handler: this
  // covers every current route and every future one, and getting it wrong is
  // silent. Anyone could trigger a 500 with `?sessionId=x` without
  // authenticating, which both misreports the fault and would bury genuine 500s
  // once errors are forwarded to a monitoring service.
  if ((err as { code?: string }).code === '22P02') {
    res.status(400).json({ error: 'Malformed identifier in request' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

/**
 * Unmatched /api routes.
 *
 * Express's default handler answers with an HTML error page, which is the wrong
 * content type for an API and tells a caller more about the stack than it needs
 * to. Mounted after the router and before errorHandler.
 */
export function notFoundHandler(req: Request, res: Response) {
  // originalUrl, not path: the handler is mounted at /api, so req.path has that
  // prefix stripped and would report a route the caller never asked for.
  // Query strings are dropped — they can carry a token on the SSE endpoint.
  const url = req.originalUrl.split('?')[0];
  res.status(404).json({ error: `Cannot ${req.method} ${url}` });
}
