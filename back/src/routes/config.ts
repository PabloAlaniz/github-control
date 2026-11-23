import { Hono } from 'hono';
import { z } from 'zod';
import { serviceContext, type HttpEnv } from '../http/context';
import { ACTIONS } from '../domain/activity';
import { BASELINE_SETTINGS, isBaselineKey } from '../domain/repo-baseline';
import { applyBaseline, ConfigApplyError } from '../services/config-apply.service';
import { syncSignals } from '../services/signal.service';

export const configRoutes = new Hono<HttpEnv>();

const ApplySchema = z.object({
  keys: z.array(z.string()).min(1).optional(),
}).default({});

/**
 * Apply the repo settings baseline on GitHub. Changes only the settings that
 * differ from the baseline (optionally limited to `keys`), logs each change
 * and refreshes the cached `config` signal.
 */
configRoutes.post('/:owner/:repo/config/apply', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;

  let body: unknown = {};
  try {
    const text = await c.req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  const unknown = (parsed.data.keys ?? []).filter(k => !isBaselineKey(k));
  if (unknown.length > 0) {
    return c.json({ error: `Not in the baseline: ${unknown.join(', ')}`, keys: BASELINE_SETTINGS.map(s => s.key) }, 400);
  }

  let applied;
  try {
    applied = await applyBaseline(c.env, owner, repo, parsed.data.keys);
  } catch (err: any) {
    if (err instanceof ConfigApplyError) return c.json({ error: err.message }, err.status);
    throw err;
  }

  for (const change of applied) {
    await c.var.storage.activity.logActivity({
      action: ACTIONS.CONFIG_APPLY,
      entityType: 'repo',
      entityId: fullName,
      fieldChanged: change.key,
      oldValue: change.from,
      newValue: change.to,
      actorType: c.req.header('X-Actor-Type') || 'human',
      actorName: c.req.header('X-Actor-Name') || 'user',
      metadata: { baseline: true },
    });
  }
  if (applied.length > 0) await syncSignals(serviceContext(c), owner, repo, ['config']);

  return c.json({ repo: fullName, applied });
});
