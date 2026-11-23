import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { syncRepoHealth, NotFoundError } from '../services/health-sync.service';
import { detectAndPersistApps } from '../services/app-detection.service';

export const healthRoutes = new Hono<HttpEnv>();

// Health sync (fetch from GitHub and update DB — includes LOC via tarball)
healthRoutes.post('/:owner/:repo/health/sync', async (c) => {
  const { owner, repo } = c.req.param();

  try {
    const result = await syncRepoHealth(serviceContext(c), owner, repo);
    return c.json({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    const fullName = `${owner}/${repo}`;
    console.error(`Health sync failed for ${fullName}:`, {
      message: error.message, status: error.status, stack: error.stack, name: error.name,
    });
    const statusCode = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return c.json({
      error: `Health sync failed: ${error.message}`,
      details: error.status ? `HTTP ${error.status}` : undefined,
    }, statusCode);
  }
});

// Health update (manual)
healthRoutes.post('/:owner/:repo/health', async (c) => {
  const { owner, repo } = c.req.param();
  const health = await c.req.json();
  await c.var.storage.health.updateManualHealth(`${owner}/${repo}`, health);
  return c.json({ success: true });
});

// Detect monorepo apps
healthRoutes.post('/:owner/:repo/detect-apps', async (c) => {
  const { owner, repo } = c.req.param();
  try {
    const result = await detectAndPersistApps(serviceContext(c), owner, repo, c.req.query('persist') === 'true');
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: `Detection failed: ${error.message}` }, 500);
  }
});
