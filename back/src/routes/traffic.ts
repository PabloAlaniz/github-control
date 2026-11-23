import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { syncRepoTraffic } from '../services/traffic.service';

export const trafficRoutes = new Hono<HttpEnv>();

const MAX_DAYS = 3650;

function daysParam(value: string | undefined, fallback: number): number {
  const days = Number.parseInt(value ?? '', 10);
  return Number.isInteger(days) && days >= 0 ? Math.min(days, MAX_DAYS) : fallback;
}

// Traffic across all repos: per-day totals and a ranking of repos.
trafficRoutes.get('/summary', async (c) => {
  const days = daysParam(c.req.query('days'), 14);
  const { traffic } = c.var.storage;
  const [daily, repos] = await Promise.all([traffic.getDailyTotals(days), traffic.getTotalsByRepo(days)]);
  const totals = { views: 0, views_unique: 0, clones: 0, clones_unique: 0 };
  for (const repo of repos) {
    totals.views += repo.views;
    totals.views_unique += repo.views_unique;
    totals.clones += repo.clones;
    totals.clones_unique += repo.clones_unique;
  }
  return c.json({ days, totals, daily, repos });
});

// Traffic of one repo: daily history plus the latest referrers and popular paths.
trafficRoutes.get('/repo/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;
  const days = daysParam(c.req.query('days'), 30);
  const { traffic } = c.var.storage;
  const [daily, referrers, paths] = await Promise.all([
    traffic.getDaily(fullName, days),
    traffic.getSources(fullName, 'referrer'),
    traffic.getSources(fullName, 'path'),
  ]);
  return c.json({ repo: fullName, days, daily, referrers, paths });
});

// Fetch the current traffic of one repo from GitHub and store it.
trafficRoutes.post('/repo/:owner/:repo/sync', async (c) => {
  const { owner, repo } = c.req.param();
  try {
    const synced = await syncRepoTraffic(serviceContext(c), owner, repo);
    if (!synced) {
      return c.json({ error: 'GitHub did not return traffic for this repo (the token needs push access to it)' }, 403);
    }
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: `Traffic sync failed: ${error.message}` }, 500);
  }
});
