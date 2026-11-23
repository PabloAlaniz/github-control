import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { buildUptime, checkAllServices, checkAndRecord } from '../services/service-check.service';
import { ACTIONS } from '../domain/activity';
import { slugify } from '../lib/slugify';

export const servicesRoutes = new Hono<HttpEnv>();

// List all services with optional filters
servicesRoutes.get('/', async (c) => {
  const rows = await c.var.storage.services.listServices({
    provider: c.req.query('provider'),
    env: c.req.query('env'),
    sourceRepo: c.req.query('source_repo'),
    isActive: c.req.query('is_active'),
  });
  return c.json(rows);
});

// Uptime history per service: % up, latency, incidents and a per-day series.
// Declared before /:slug so "uptime" is not read as a service slug.
servicesRoutes.get('/uptime', async (c) => {
  const requested = Number(c.req.query('days') ?? 30);
  const days = Number.isInteger(requested) && requested >= 1 && requested <= 90 ? requested : 30;
  const { serviceChecks } = c.var.storage;
  const [daily, incidents] = await Promise.all([serviceChecks.getDailyUptime(days), serviceChecks.getIncidents(days)]);
  return c.json(buildUptime(daily, incidents, days));
});

// Get single service by slug
servicesRoutes.get('/:slug', async (c) => {
  const service = await c.var.storage.services.getService(c.req.param('slug'));
  if (!service) return c.json({ error: 'Service not found' }, 404);
  return c.json(service);
});

// Create service
servicesRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { name, url, provider, project, region, env: serviceEnv, source_repo_full_name, source_path, description } = body;

  if (!name) return c.json({ error: 'name is required' }, 400);
  if (!provider) return c.json({ error: 'provider is required' }, 400);

  const slug = body.slug || slugify(name);
  const result = await c.var.storage.services.createService({
    name, slug, url, provider, project, region,
    env: serviceEnv, source_repo_full_name, source_path, description,
  });

  await c.var.storage.activity.logActivity({
    action: ACTIONS.SERVICE_CREATE,
    entityType: 'service', entityId: slug,
    fieldChanged: null, newValue: name,
    actorType: 'human', actorName: 'user',
    metadata: { provider, url, source_repo_full_name },
  });

  return c.json({ id: result?.id, slug: result?.slug, success: true }, 201);
});

// Update service
servicesRoutes.put('/:slug', async (c) => {
  const { slug } = c.req.param();
  const body = await c.req.json();

  const existing = await c.var.storage.services.getService(slug);
  if (!existing) return c.json({ error: 'Service not found' }, 404);

  await c.var.storage.services.updateService(slug, body);

  await c.var.storage.activity.logActivity({
    action: ACTIONS.SERVICE_UPDATE,
    entityType: 'service', entityId: slug,
    fieldChanged: null, newValue: JSON.stringify(body),
    actorType: 'human', actorName: 'user',
  });

  return c.json({ success: true });
});

// Delete service
servicesRoutes.delete('/:slug', async (c) => {
  const { slug } = c.req.param();

  const existing = await c.var.storage.services.getServiceForDelete(slug);
  if (!existing) return c.json({ error: 'Service not found' }, 404);

  await c.var.storage.services.deleteService(slug);

  await c.var.storage.activity.logActivity({
    action: ACTIONS.SERVICE_DELETE,
    entityType: 'service', entityId: slug,
    fieldChanged: null, oldValue: (existing as any).name,
    actorType: 'human', actorName: 'user',
  });

  return c.json({ success: true });
});

// Health check single service
servicesRoutes.post('/:slug/health-check', async (c) => {
  const { slug } = c.req.param();

  const service = await c.var.storage.services.getServiceBasic(slug);
  if (!service) return c.json({ error: 'Service not found' }, 404);
  if (!service.url) return c.json({ error: 'Service has no URL configured' }, 400);

  const { status, httpCode, responseMs } = await checkAndRecord(serviceContext(c), { slug, url: service.url });

  await c.var.storage.activity.logActivity({
    action: ACTIONS.SERVICE_HEALTH_CHECK,
    entityType: 'service', entityId: slug,
    fieldChanged: 'last_check_status', newValue: status,
    actorType: 'human', actorName: 'manual_health_check',
    metadata: { httpCode, responseMs, url: service.url },
  });

  return c.json({ slug, name: service.name, status, httpCode, responseMs, checkedAt: new Date().toISOString() });
});

// Batch health check all active services
servicesRoutes.post('/health-check-all', async (c) => {
  return c.json(await checkAllServices(serviceContext(c)));
});

// Sync services from repos that have homepage URLs
servicesRoutes.post('/sync-from-repos', async (c) => {
  const { updatedCount, createdCount } = await c.var.storage.services.syncFromRepos();

  await c.var.storage.activity.logActivity({
    action: ACTIONS.SERVICE_UPDATE,
    entityType: 'service', entityId: 'sync-from-repos',
    fieldChanged: null, newValue: JSON.stringify({ updated: updatedCount, created: createdCount }),
    actorType: c.req.header('X-Actor-Type') || 'human',
    actorName: c.req.header('X-Actor-Name') || 'user',
  });

  return c.json({ updated: updatedCount, created: createdCount });
});

// Get services for a specific repo
servicesRoutes.get('/by-repo/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const rows = await c.var.storage.services.listServicesByRepo(`${owner}/${repo}`);
  return c.json(rows);
});
