import { Hono } from 'hono';
import { z } from 'zod';
import type { HttpEnv } from '../http/context';
import { SettingsError } from '../application/ports/settings';

export const settingsRoutes = new Hono<HttpEnv>();

const PatchSchema = z.object({
  githubToken: z.string().min(1).max(500),
  githubOrgs: z.array(z.string().regex(/^[A-Za-z0-9-]+$/, 'Invalid organization name')).max(50),
  syncIntervalHours: z.number().int().min(0).max(24 * 30),
  publicBadges: z.boolean(),
  publicStatus: z.boolean(),
  repoBaseline: z.record(z.string().max(60), z.boolean()),
  password: z.object({
    current: z.string().min(1),
    next: z.string().min(8, 'Password must be at least 8 characters').max(200),
  }),
}).partial().strict();

// What can be changed here. `editable: false` where configuration is fixed at deploy time.
settingsRoutes.get('/', (c) => {
  const store = c.env.settings;
  return c.json(store ? { editable: true, ...store.read() } : { editable: false });
});

settingsRoutes.patch('/', async (c) => {
  const store = c.env.settings;
  if (!store) {
    return c.json({ error: 'Settings are fixed by the deployment configuration on this server' }, 501);
  }

  const parsed = PatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid settings', details: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({ editable: true, ...(await store.update(parsed.data)) });
  } catch (error) {
    if (error instanceof SettingsError) return c.json({ error: error.message }, 400);
    throw error;
  }
});
