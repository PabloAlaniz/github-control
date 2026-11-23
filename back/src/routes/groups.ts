import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { slugify } from '../lib/slugify';

export const groupsRoutes = new Hono<HttpEnv>();

// List all groups (repo_count only includes active repos)
groupsRoutes.get('/', async (c) => {
  const rows = await c.var.storage.groups.listGroups();
  return c.json(rows);
});

// Create group
groupsRoutes.post('/', async (c) => {
  const { slug, name, description, color } = await c.req.json();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const finalSlug = slug || slugify(name);
  const result = await c.var.storage.groups.createGroup(finalSlug, name, description, color);
  return c.json({ id: result?.id, success: true });
});

// Update group
groupsRoutes.put('/:id', async (c) => {
  const { id } = c.req.param();
  const { slug, name, description, color } = await c.req.json();
  await c.var.storage.groups.updateGroup(parseInt(id), slug, name, description, color);
  return c.json({ success: true });
});

// Delete group
groupsRoutes.delete('/:id', async (c) => {
  const { id } = c.req.param();
  await c.var.storage.groups.deleteGroup(parseInt(id));
  return c.json({ success: true });
});

// Add repo to group
groupsRoutes.post('/:id/repos', async (c) => {
  const { id } = c.req.param();
  const { full_name } = await c.req.json();

  const repo = await c.var.storage.groups.getRepoId(full_name);
  if (!repo) return c.json({ error: 'Repo not found' }, 404);

  await c.var.storage.groups.addRepoToGroup(repo.id, parseInt(id));
  return c.json({ success: true });
});

// Remove repo from group
groupsRoutes.delete('/:id/repos', async (c) => {
  const { id } = c.req.param();
  const { full_name } = await c.req.json();

  const repo = await c.var.storage.groups.getRepoId(full_name);
  if (!repo) return c.json({ error: 'Repo not found' }, 404);

  await c.var.storage.groups.removeRepoFromGroup(repo.id, parseInt(id));
  return c.json({ success: true });
});
