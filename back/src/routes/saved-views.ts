import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { SavedViewSchema } from '../schemas/saved-views';

export const savedViewsRoutes = new Hono<HttpEnv>();

// List saved views
savedViewsRoutes.get('/', async (c) => {
  return c.json(await c.var.storage.savedViews.listSavedViews());
});

// Create a view, or overwrite the filters of the one with the same name
savedViewsRoutes.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = SavedViewSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const view = await c.var.storage.savedViews.upsertSavedView(parsed.data.name, parsed.data.query);
  return c.json({ success: true, view });
});

// Delete a view
savedViewsRoutes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const deleted = await c.var.storage.savedViews.deleteSavedView(id);
  if (!deleted) return c.json({ error: 'View not found' }, 404);
  return c.json({ success: true });
});
