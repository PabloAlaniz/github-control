import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { verifySignature, WEBHOOK_EVENTS } from '../lib/github/webhook';
import { handleGithubEvent } from '../services/webhook.service';

/**
 * GitHub webhook receiver. It takes no API key: GitHub cannot send one. Every
 * delivery must instead be signed with GITHUB_WEBHOOK_SECRET, and without that
 * secret configured the endpoint does not exist.
 */
export const webhookRoutes = new Hono<HttpEnv>();

const MAX_BYTES = 5_000_000;

webhookRoutes.post('/github', async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: 'Webhooks are not set up' }, 404);

  const body = await c.req.text();
  if (body.length > MAX_BYTES) return c.json({ error: 'Payload too large' }, 413);
  if (!(await verifySignature(secret, body, c.req.header('X-Hub-Signature-256')))) {
    return c.json({ error: 'Signature does not match' }, 401);
  }

  const event = c.req.header('X-GitHub-Event') ?? '';
  if (event === 'ping') return c.json({ ok: true, pong: true });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  // Always 2xx for a delivery that was understood, handled or not: an error would make GitHub mark the webhook as failing.
  return c.json({ ok: true, event, ...(await handleGithubEvent(serviceContext(c), event, payload)) }, 202);
});

/** What the settings page needs to explain the setup. Signed-in clients only. */
export const webhookInfoRoutes = new Hono<HttpEnv>();

webhookInfoRoutes.get('/', (c) => c.json({
  enabled: !!c.env.GITHUB_WEBHOOK_SECRET,
  path: '/api/webhooks/github',
  events: WEBHOOK_EVENTS,
}));
