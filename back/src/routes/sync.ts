import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { getSyncStatus, startFullSync } from '../services/full-sync.service';

export const syncRoutes = new Hono<HttpEnv>();

// Current state of the full sync: running or not, progress, last result.
syncRoutes.get('/status', (c) => c.json(getSyncStatus(serviceContext(c))));

// Start a full sync in the background (no-op when one is already running).
syncRoutes.post('/', (c) => {
  if (!c.env.GITHUB_TOKEN) return c.json({ error: 'GITHUB_TOKEN is not configured' }, 500);

  const ctx = serviceContext(c);
  const { started, finished } = startFullSync(ctx, { trigger: 'manual' });

  // On Cloudflare Workers the work must be registered to outlive the response.
  try {
    c.executionCtx.waitUntil(finished);
  } catch {
    // Node: no execution context; the promise simply keeps running.
  }

  return c.json({ started, ...getSyncStatus(ctx) }, 202);
});
