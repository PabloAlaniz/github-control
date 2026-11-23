import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { HttpEnv } from './http/context';
import { createStorage } from './infrastructure/storage';
import { reposRoutes } from './routes/repos';
import { healthRoutes } from './routes/health';
import { coverageRoutes } from './routes/coverage';
import { readmeRoutes } from './routes/readme';
import { groupsRoutes } from './routes/groups';
import { viewsRoutes } from './routes/views';
import { activityRoutes } from './routes/activity';
import { metaRoutes } from './routes/meta';
import { authRoutes } from './routes/auth';
import { metricsRoutes } from './routes/metrics';
import { servicesRoutes } from './routes/services';
import { repoAppsRoutes } from './routes/repo-apps';
import { backupRoutes } from './routes/backup';
import { syncRoutes } from './routes/sync';
import { trafficRoutes } from './routes/traffic';
import { badgeRoutes } from './routes/badges';
import { settingsRoutes } from './routes/settings';
import { savedViewsRoutes } from './routes/saved-views';
import { signalsRoutes } from './routes/signals';
import { dependenciesRoutes } from './routes/dependencies';
import { branchesRoutes } from './routes/branches';
import { configRoutes } from './routes/config';
import { runScheduledChecks } from './services/service-check.service';
import { apiKeyAuth } from './middleware/auth';
import { demoGuard } from './middleware/demo';
import { onError } from './lib/error-handler';

const app = new Hono<HttpEnv>();

// Global error handler
app.onError(onError);

// Middleware
app.use('*', logger());
app.use('/api/*', cors());

// Composition root: the storage adapter is chosen here, once, from config.
// Everything downstream only sees the `Storage` port.
app.use('/api/*', async (c, next) => {
  c.set('storage', createStorage(c.env));
  await next();
});

// Health check (liveness)
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT
  });
});

// Readiness check (validates required env vars)
app.get('/api/health/ready', (c) => {
  const checks: Record<string, 'ok' | 'missing'> = {};
  const critical = ['DATABASE_URL', 'GITHUB_TOKEN', 'API_KEY'];
  const optional = ['JWT_SECRET', 'AUTH_USERNAME', 'AUTH_PASSWORD'];
  for (const key of [...critical, ...optional]) {
    const val = c.env[key as keyof typeof c.env];
    checks[key] = val && String(val).trim().length > 0 ? 'ok' : 'missing';
  }
  const missingCritical = critical.filter(k => checks[k] === 'missing');
  const missingAll = Object.entries(checks).filter(([, v]) => v === 'missing').map(([k]) => k);
  const missingAuth = optional.filter(k => checks[k] === 'missing' && k.startsWith('AUTH_'));
  if (missingAuth.length > 0) {
    console.warn(`⚠️ Auth secrets missing: ${missingAuth.join(', ')} — login will not work. Set via: wrangler secret put <NAME>`);
  }
  const status = missingCritical.length === 0 ? 'ok' : 'degraded';
  return c.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    missing: missingAll.length > 0 ? missingAll : undefined
  }, status === 'ok' ? 200 : 503);
});

// Setup status (public). If this app is answering, the instance is configured;
// the Node server answers `configured: false` itself while the wizard is pending.
app.get('/api/setup/status', (c) => c.json({
  configured: true,
  // Lets the frontend skip its login screen when the server has auth turned off.
  authRequired: !(c.env.DISABLE_AUTH === 'true' || c.env.DISABLE_AUTH === true),
  // Present only on a demo instance: the frontend says so and explains what resets.
  ...(c.env.DEMO && {
    demo: { readOnly: c.env.DEMO === 'readonly', resetMinutes: Number(c.env.DEMO_RESET_MINUTES ?? 0) },
  }),
}));

// Public README badges (opt-in, public repos only). Mounted before the auth middleware.
app.route('/api/badges', badgeRoutes);

// Auth routes (public, before API key middleware)
app.route('/api/auth', authRoutes);

// API key auth (after health check and auth routes so they stay public)
app.use('/api/*', apiKeyAuth);

// Demo instances: only reads, plus edits of local data when the demo is editable.
app.use('/api/*', demoGuard);

// Mount routes
app.route('/api/repos', reposRoutes);
app.route('/api/repos', healthRoutes);
app.route('/api/repos', coverageRoutes);
app.route('/api/repos', readmeRoutes);
app.route('/api/repos', signalsRoutes);
app.route('/api/repos', branchesRoutes);
app.route('/api/repos', configRoutes);
app.route('/api/groups', groupsRoutes);
app.route('/api/views', viewsRoutes);
app.route('/api/saved-views', savedViewsRoutes);
app.route('/api/dependencies', dependenciesRoutes);
app.route('/api/activity', activityRoutes);
app.route('/api/meta', metaRoutes);
app.route('/api/metrics', metricsRoutes);
app.route('/api/services', servicesRoutes);
app.route('/api/repo-apps', repoAppsRoutes);
app.route('/api/sync', syncRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/traffic', trafficRoutes);
app.route('/api', backupRoutes);

// Stats endpoint
app.get('/api/stats', async (c) => {
  const stats = await c.var.storage.repos.getStats();

  return c.json({
    total: stats.total,
    withCi: stats.with_ci,
    withTests: stats.with_tests,
    archived: stats.archived,
    deleted: stats.deleted,
    paused: stats.paused,
  });
});

// User endpoint
app.get('/api/user', async (c) => {
  const { getAuthenticatedUser } = await import('./lib/github');
  try {
    const user = await getAuthenticatedUser(c.env);
    return c.json(user);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Cache status
app.get('/api/cache/status', async (c) => {
  const result = await c.var.storage.repos.getCacheStatus();

  return c.json({ repoCount: result.count, lastSync: result.latest });
});

// Pull Requests endpoints
app.get('/api/prs', async (c) => {
  const { getAllOpenPRs } = await import('./lib/github');
  try {
    const prs = await getAllOpenPRs(c.env);
    return c.json({
      count: prs.length,
      prs: prs.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.get('/api/repos/:owner/:repo/prs', async (c) => {
  const { owner, repo } = c.req.param();
  const { getAllOpenPRs } = await import('./lib/github');
  try {
    const allPRs = await getAllOpenPRs(c.env);
    const repoPRs = allPRs.filter(pr =>
      pr.repository_url?.includes(`/${owner}/${repo}`)
    );
    return c.json({ count: repoPRs.length, prs: repoPRs });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Fallback: serve static assets for non-API routes
app.get('*', async (c) => {
  // In development (no ASSETS binding), return helpful message
  if (!c.env.ASSETS) {
    return c.json({
      message: 'Development mode: Frontend is running on Vite dev server',
      frontendUrl: 'http://localhost:13338',
      environment: c.env.ENVIRONMENT || 'development'
    }, 404);
  }

  // In production, serve static assets
  return c.env.ASSETS.fetch(c.req.raw);
});

/**
 * Cloudflare Cron Trigger (see [triggers] in wrangler.toml): checks the active
 * services and records the result in the uptime history. The Node server runs
 * the same checks on its own timer.
 */
async function scheduled(
  _event: unknown, env: HttpEnv['Bindings'], ctx: { waitUntil(promise: Promise<unknown>): void },
) {
  ctx.waitUntil(runScheduledChecks({ config: env, storage: createStorage(env) }));
}

// The Worker exports the Hono app (fetch) plus the cron handler.
export default Object.assign(app, { scheduled });
