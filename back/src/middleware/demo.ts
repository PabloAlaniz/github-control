import { createMiddleware } from 'hono/factory';
import type { AppConfig } from '../config';

/**
 * Writes that only touch the instance's own data. In an editable demo these
 * are allowed (the dataset is reloaded on a timer); everything else that
 * writes would call GitHub, another service or the configuration.
 */
const LOCAL_WRITES = [
  /^\/api\/meta\//,
  /^\/api\/groups(\/|$)/,
  /^\/api\/saved-views(\/|$)/,
  /^\/api\/repos\/[^/]+\/[^/]+\/(priority|status|blockers)$/,
];

/** GitHub reads the dashboard itself does not need; with the demo's placeholder token they could only fail. */
const GITHUB_READS = [
  /^\/api\/user$/,
  /^\/api\/prs$/,
  /^\/api\/repos\/[^/]+\/[^/]+\/(prs|readme)$/,
];

/** Requests that are not GETs but change nothing: fine in any demo. */
const DRY_RUNS = [
  /^\/api\/policy\/plan$/,
  // MCP messages are POSTs; what a tool does goes through this guard again as its own request.
  /^\/api\/mcp$/,
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function demoAllows(mode: string, method: string, path: string): boolean {
  if (READ_METHODS.has(method)) return !GITHUB_READS.some((pattern) => pattern.test(path));
  if (method === 'POST' && DRY_RUNS.some((pattern) => pattern.test(path))) return true;
  return mode === 'true' && LOCAL_WRITES.some((pattern) => pattern.test(path));
}

/** In demo mode, answers 403 to whatever the demo cannot do. A no-op otherwise. */
export const demoGuard = createMiddleware<{ Bindings: AppConfig }>(async (c, next) => {
  const mode = c.env.DEMO;
  if (!mode || demoAllows(mode, c.req.method, new URL(c.req.url).pathname)) {
    await next();
    return;
  }
  return c.json({ error: 'Not available in the demo: it runs on fictional data, without a GitHub account.', demo: true }, 403);
});
