import { createMiddleware } from 'hono/factory';
import { verify } from 'hono/jwt';
import type { AppConfig } from '../config';
import { constantTimeEqual } from '../lib/password';

export const apiKeyAuth = createMiddleware<{ Bindings: AppConfig }>(async (c, next) => {
  // Skip auth for health/readiness (orchestrators) and auth routes (login)
  const path = new URL(c.req.url).pathname;
  if (path === '/api/health' || path === '/api/health/ready' || path === '/api/setup/status'
    || path.startsWith('/api/auth') || path.startsWith('/api/badges/')) {
    await next();
    return;
  }
  // Skip auth in local development if disabled
  if (c.env.DISABLE_AUTH === 'true' || c.env.DISABLE_AUTH === true) {
    await next();
    return;
  }

  const header = c.req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const token = header.slice(7);

  // Path 1: API_KEY or CI_COVERAGE_TOKEN (existing behavior)
  const matches = (secret?: string) => !!secret && constantTimeEqual(token, secret);
  if (matches(c.env.API_KEY) || matches(c.env.CI_COVERAGE_TOKEN)) {
    await next();
    return;
  }

  // Path 2: JWT verification
  if (c.env.JWT_SECRET) {
    try {
      await verify(token, c.env.JWT_SECRET, 'HS256');
      await next();
      return;
    } catch (e) {
      console.error('JWT verification failed:', e instanceof Error ? e.message : e);
    }
  }

  return c.json({ error: 'Invalid API key' }, 401);
});
