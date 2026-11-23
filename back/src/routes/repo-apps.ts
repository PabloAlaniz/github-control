import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { getRepoTree } from '../lib/github';
import { syncAppHealth } from '../services/health-sync.service';
import { appSlugify } from '../lib/slugify';

export const repoAppsRoutes = new Hono<HttpEnv>();

// List all repo apps (optional ?repo=owner/name filter)
repoAppsRoutes.get('/', async (c) => {
  const rows = await c.var.storage.apps.listApps(c.req.query('repo'));
  return c.json(rows);
});

// Get single app by slug
repoAppsRoutes.get('/:slug', async (c) => {
  const app = await c.var.storage.apps.getApp(c.req.param('slug'));
  if (!app) return c.json({ error: 'App not found' }, 404);
  return c.json(app);
});

// Create/register an app
repoAppsRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const { repo_full_name, app_path, app_name, stack, detection_source } = body;

  if (!repo_full_name || !app_path || !app_name) {
    return c.json({ error: 'repo_full_name, app_path, and app_name are required' }, 400);
  }

  const slug = body.slug || appSlugify(repo_full_name, app_name);
  const result = await c.var.storage.apps.upsertApp({
    repo_full_name, app_path, app_name, slug,
    stack: stack || null, detection_source: detection_source || 'manual',
  });

  await c.var.storage.activity.logActivity({
    action: 'repo_app.create',
    entityType: 'repo_app', entityId: slug,
    fieldChanged: null,
    newValue: `${app_name} in ${repo_full_name}`,
    actorType: c.req.header('X-Actor-Type') || 'human',
    actorName: c.req.header('X-Actor-Name') || 'user',
  });

  return c.json({ id: result?.id, slug: result?.slug, success: true }, 201);
});

// Update app
repoAppsRoutes.put('/:slug', async (c) => {
  const { slug } = c.req.param();
  const body = await c.req.json();

  const existing = await c.var.storage.apps.getApp(slug);
  if (!existing) return c.json({ error: 'App not found' }, 404);

  await c.var.storage.apps.updateApp(slug, body);
  return c.json({ success: true });
});

// Delete app
repoAppsRoutes.delete('/:slug', async (c) => {
  const { slug } = c.req.param();

  const existing = await c.var.storage.apps.getAppForDelete(slug);
  if (!existing) return c.json({ error: 'App not found' }, 404);

  await c.var.storage.apps.deleteApp(slug);

  await c.var.storage.activity.logActivity({
    action: 'repo_app.delete',
    entityType: 'repo_app', entityId: slug,
    fieldChanged: null,
    oldValue: (existing as any).app_name,
    actorType: c.req.header('X-Actor-Type') || 'human',
    actorName: c.req.header('X-Actor-Name') || 'user',
  });

  return c.json({ success: true });
});

// Per-app health sync (scoped to app_path)
repoAppsRoutes.post('/:slug/health/sync', async (c) => {
  const { slug } = c.req.param();

  const app = await c.var.storage.apps.getAppBasic(slug);
  if (!app) return c.json({ error: 'App not found' }, 404);

  const [owner, repo] = app.repo_full_name.split('/');

  try {
    const health = await syncAppHealth(serviceContext(c), owner, repo, app.app_path, slug);

    await c.var.storage.activity.logActivity({
      action: 'repo_app.health_sync',
      entityType: 'repo_app', entityId: slug,
      fieldChanged: 'health_metrics',
      newValue: `Synced: ${health.loc} LOC, ${health.fileCount} files`,
      actorType: c.req.header('X-Actor-Type') || 'human',
      actorName: c.req.header('X-Actor-Name') || 'manual_sync',
      metadata: health,
    });

    return c.json({ success: true, health });
  } catch (error: any) {
    console.error(`App health sync failed for ${slug}:`, error.message);
    return c.json({ error: `Health sync failed: ${error.message}` }, 500);
  }
});

// Batch sync all apps for a repo
repoAppsRoutes.post('/sync-by-repo/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const repoFullName = `${owner}/${repo}`;

  const apps = await c.var.storage.apps.listAppsByRepo(repoFullName);
  if (!apps || apps.length === 0) {
    return c.json({ synced: 0, results: [] });
  }

  let tree;
  try {
    tree = await getRepoTree(c.env, owner, repo);
  } catch (error: any) {
    return c.json({ error: `Failed to fetch repo tree: ${error.message}` }, 500);
  }

  const results: any[] = [];

  for (const app of apps) {
    try {
      const health = await syncAppHealth(serviceContext(c), owner, repo, app.app_path, app.slug, tree);
      results.push({ app_name: app.app_name, slug: app.slug, ...health });
    } catch (error: any) {
      console.error(`Batch sync failed for app ${app.slug}:`, error.message);
      results.push({ app_name: app.app_name, slug: app.slug, error: error.message });
    }
  }

  await c.var.storage.activity.logActivity({
    action: 'repo_app.batch_sync',
    entityType: 'repo', entityId: repoFullName,
    fieldChanged: 'health_metrics',
    newValue: `Batch synced ${results.length} apps`,
    actorType: c.req.header('X-Actor-Type') || 'human',
    actorName: c.req.header('X-Actor-Name') || 'manual_sync',
  });

  return c.json({ synced: results.filter(r => !r.error).length, results });
});
