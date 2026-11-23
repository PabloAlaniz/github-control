/**
 * Hono typing and helpers shared by every route module.
 *
 * `Bindings` is the runtime configuration; `Variables.storage` is injected by
 * the composition root (`index.ts`), so routes never import an adapter.
 */
import type { Context } from 'hono';
import type { AppConfig } from '../config';
import type { AppContext } from '../application/context';
import type { Storage } from '../application/ports/storage';

export type HttpEnv = {
  Bindings: AppConfig & {
    /** Cloudflare static assets binding (absent in dev and on Node). */
    ASSETS?: { fetch: (request: Request) => Response | Promise<Response> };
  };
  Variables: { storage: Storage };
};

/** Builds the context handed to application services. */
export function serviceContext(c: Context<HttpEnv>): AppContext {
  return { config: c.env, storage: c.var.storage };
}
