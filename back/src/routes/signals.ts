import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { SIGNAL_KINDS, isSignalKind } from '../lib/signals';
import { groupSignals, syncSignals } from '../services/signal.service';

export const signalsRoutes = new Hono<HttpEnv>();

// Cached signals for a repo, with their full detail
signalsRoutes.get('/:owner/:repo/signals', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;
  const records = await c.var.storage.signals.getRepoSignals(fullName);
  return c.json({ repo: fullName, signals: groupSignals(records).get(fullName) ?? {} });
});

// Fetch signals from GitHub and cache them. ?kinds=a,b limits which ones (default: all).
signalsRoutes.post('/:owner/:repo/signals/sync', async (c) => {
  const { owner, repo } = c.req.param();
  const requested = c.req.query('kinds')?.split(',').map(k => k.trim()).filter(Boolean);
  const unknown = requested?.filter(k => !isSignalKind(k)) ?? [];
  if (unknown.length > 0) {
    return c.json({ error: `Unknown signal kind: ${unknown.join(', ')}`, kinds: SIGNAL_KINDS }, 400);
  }

  const results = await syncSignals(serviceContext(c), owner, repo, requested?.filter(isSignalKind));
  if (results === null) return c.json({ error: 'Repo not found' }, 404);

  return c.json({
    repo: `${owner}/${repo}`,
    ok: results.every(r => r.ok),
    results,
  });
});
