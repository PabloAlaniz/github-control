import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

const GENERIC_MESSAGE = 'Internal server error';

/**
 * Answers a 500 without the error's own message. A storage or driver error can
 * carry SQL, file paths or a connection string, so the detail goes to the
 * server log and the client gets a fixed text. `extra` keeps the response shape
 * a caller expects (for example an empty list next to the error).
 */
export function internalError(c: Context, err: unknown, extra: Record<string, unknown> = {}) {
  console.error(`[${c.req.method} ${c.req.path}]`, err);
  return c.json({ error: GENERIC_MESSAGE, ...extra }, 500);
}

/**
 * Global `onError`. An `HTTPException` is a deliberate answer and keeps its
 * status and message; anything else is unexpected and becomes a generic 500.
 */
export function onError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    if (err.res) return err.getResponse();
    if (err.status >= 500) return internalError(c, err);
    return c.json({ error: err.message }, err.status);
  }
  return internalError(c, err);
}
