import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import type { Storage } from '../application/ports/storage';
import { computeHealthScore, repoRowToHealthInput } from '../lib/analyzers/healthScore';
import { compactNumber, renderBadge } from '../lib/badge';

/**
 * Public SVG badges for READMEs, e.g. /api/badges/acme/api/views.svg
 *
 * They are served without authentication, so they are off unless
 * PUBLIC_BADGES=true, and they only ever exist for public, non-deleted repos:
 * a private repo answers exactly like one that does not exist.
 */
export const badgeRoutes = new Hono<HttpEnv>();

const TRAFFIC_DAYS = 14;

type Badge = { label: string; value: string; color: string };
type Metric = (repo: Record<string, any>, storage: Storage) => Promise<Badge> | Badge;

async function trafficTotal(storage: Storage, fullName: string, field: 'views' | 'clones'): Promise<number> {
  const days = await storage.traffic.getDaily(fullName, TRAFFIC_DAYS);
  return days.reduce((sum, day) => sum + day[field], 0);
}

const METRICS: Record<string, Metric> = {
  stars: (repo) => ({ label: 'stars', value: compactNumber(repo.stars ?? 0), color: 'blue' }),
  loc: (repo) => ({ label: 'lines of code', value: compactNumber(repo.loc ?? 0), color: 'blue' }),
  views: async (repo, storage) => ({
    label: `views (${TRAFFIC_DAYS}d)`, value: compactNumber(await trafficTotal(storage, repo.full_name, 'views')), color: 'blue',
  }),
  clones: async (repo, storage) => ({
    label: `clones (${TRAFFIC_DAYS}d)`, value: compactNumber(await trafficTotal(storage, repo.full_name, 'clones')), color: 'blue',
  }),
  health: (repo) => {
    const { score } = computeHealthScore(repoRowToHealthInput(repo));
    return { label: 'health', value: `${score}/100`, color: score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red' };
  },
  coverage: (repo) => {
    const coverage = repo.test_coverage;
    if (coverage === null || coverage === undefined) return { label: 'coverage', value: 'unknown', color: 'gray' };
    return { label: 'coverage', value: `${coverage}%`, color: coverage >= 80 ? 'green' : coverage >= 50 ? 'yellow' : 'red' };
  },
};

export const BADGE_METRICS = Object.keys(METRICS);

badgeRoutes.get('/:owner/:repo/:file', async (c) => {
  if (c.env.PUBLIC_BADGES !== 'true') return c.json({ error: 'Badges are disabled' }, 404);

  const { owner, repo: name, file } = c.req.param();
  const metricName = file.endsWith('.svg') ? file.slice(0, -4) : '';
  const metric: Metric | undefined = Object.hasOwn(METRICS, metricName) ? METRICS[metricName] : undefined;
  const repo = metric ? await c.var.storage.repos.getRepo(`${owner}/${name}`) : null;
  if (!metric || !repo || repo.is_private !== false || repo.is_deleted === true) {
    return c.json({ error: 'Badge not found' }, 404);
  }

  const badge = await metric(repo, c.var.storage);
  return c.body(renderBadge(badge.label, badge.value, badge.color), 200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
});
