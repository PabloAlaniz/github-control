import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { ACTIONS } from '../domain/activity';

export const metaRoutes = new Hono<HttpEnv>();

// Get all meta (summary stats per field — active repos only)
metaRoutes.get('/', async (c) => {
  const result = await c.var.storage.meta.getMetaSummary();
  return c.json(result);
});

// Get repo meta
metaRoutes.get('/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const row = await c.var.storage.meta.getRepoMeta(`${owner}/${repo}`);
  if (!row) return c.json({ error: 'Repo not found' }, 404);
  return c.json(row);
});

// Update repo meta
metaRoutes.patch('/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const updates = await c.req.json();

  const result = await c.var.storage.meta.patchRepoMeta(`${owner}/${repo}`, updates);
  if (!result) return c.json({ error: 'No valid fields to update' }, 400);

  // Audit only explicit notes edits (patchRepoMeta is also used by automated
  // health-check writes, which should not spam the activity log).
  if ('notes' in updates) {
    await c.var.storage.activity.logActivity({
      action: ACTIONS.NOTES_SET,
      entityType: 'repo',
      entityId: `${owner}/${repo}`,
      fieldChanged: 'notes',
      newValue: updates.notes,
      actorType: c.req.header('X-Actor-Type') || 'human',
      actorName: c.req.header('X-Actor-Name') || 'user',
    });
  }

  return c.json({ success: true });
});

// Bulk update meta
metaRoutes.post('/bulk', async (c) => {
  const { updates } = await c.req.json();
  await c.var.storage.meta.bulkUpdateMeta(updates);
  return c.json({ success: true, updated: updates.length });
});
