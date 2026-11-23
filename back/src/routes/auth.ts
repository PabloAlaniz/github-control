import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { constantTimeEqual, verifyPassword } from '../lib/password';
import { AttemptLimiter } from '../lib/rate-limit';
import type { HttpEnv } from '../http/context';

/** Header the Node server sets from the socket address (never taken from the client). */
export const CLIENT_IP_HEADER = 'x-ghc-client-ip';

/** 10 failed sign-ins per client in 15 minutes, then it has to wait. */
export const loginLimiter = new AttemptLimiter(10, 15 * 60_000);

export const authRoutes = new Hono<HttpEnv>();

authRoutes.post('/login', async (c) => {
  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'JWT_SECRET is not configured' }, 500);
  }

  const client = c.req.header(CLIENT_IP_HEADER) || c.req.header('cf-connecting-ip') || 'unknown';
  const retryAfter = loginLimiter.retryAfterSeconds(client);
  if (retryAfter > 0) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many failed sign-in attempts. Try again later.' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.username || !body.password) {
    return c.json({ error: 'Username and password are required' }, 400);
  }

  const username = String(body.username);
  const password = String(body.password);
  const { AUTH_USERNAME, AUTH_PASSWORD, AUTH_PASSWORD_HASH } = c.env;

  // Always check both, so the response time does not reveal which one was wrong.
  const userOk = !!AUTH_USERNAME && constantTimeEqual(username, AUTH_USERNAME);
  const passwordOk = AUTH_PASSWORD_HASH
    ? await verifyPassword(password, AUTH_PASSWORD_HASH)
    : !!AUTH_PASSWORD && constantTimeEqual(password, AUTH_PASSWORD);

  if (!userOk || !passwordOk) {
    loginLimiter.recordFailure(client);
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  loginLimiter.reset(client);

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 86400; // 24 hours

  const token = await sign(
    { sub: body.username, iat: now, exp },
    c.env.JWT_SECRET
  );

  return c.json({ token, expiresIn: 86400 });
});
