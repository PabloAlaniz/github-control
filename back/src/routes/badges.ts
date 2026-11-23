import { Hono, type Context } from 'hono';
import type { HttpEnv } from '../http/context';
import type { Storage } from '../application/ports/storage';
import { computeHealthScore, repoRowToHealthInput } from '../lib/analyzers/healthScore';
import { compactNumber, renderBadge, type BadgeStyle } from '../lib/badge';
import { cardTheme, renderRepoCard, renderSummaryCard } from '../lib/cards';
import { LANGUAGE_COLORS } from '../lib/language-colors';

/**
 * Public SVG badges and cards for READMEs:
 *
 *   /api/badges/acme/api/views.svg        a badge (?label=, ?style=flat-square)
 *   /api/badges/acme/api/card.svg         a card for one repo (?theme=auto|light|dark)
 *   /api/badges/summary.svg               totals over every public repo (?theme=, ?title=)
 *
 * They are served without authentication, so they are off unless
 * PUBLIC_BADGES=true, and they only ever exist for public, non-deleted repos:
 * a private repo answers exactly like one that does not exist, and the summary
 * counts public repos only.
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

/** The repo's cached `release` signal, or null when it was never synced. */
async function releaseSignal(storage: Storage, fullName: string): Promise<Record<string, any> | null> {
  return (await storage.signals.getRepoSignals(fullName)).find((signal) => signal.kind === 'release')?.data ?? null;
}

METRICS.ci = (repo) => {
  const status = repo.ci_status;
  if (status === 'success') return { label: 'CI', value: 'passing', color: 'green' };
  if (status === 'failure') return { label: 'CI', value: 'failing', color: 'red' };
  return { label: 'CI', value: status === 'in_progress' ? 'running' : 'unknown', color: 'gray' };
};
METRICS.release = async (repo, storage) => {
  const release = await releaseSignal(storage, repo.full_name);
  return release?.hasRelease
    ? { label: 'release', value: String(release.tag), color: 'blue' }
    : { label: 'release', value: 'none', color: 'gray' };
};
METRICS.downloads = async (repo, storage) => {
  const downloads = (await releaseSignal(storage, repo.full_name))?.downloads;
  return typeof downloads === 'number'
    ? { label: 'downloads', value: compactNumber(downloads), color: 'blue' }
    : { label: 'downloads', value: 'unknown', color: 'gray' };
};

export const BADGE_METRICS = Object.keys(METRICS);

const SVG_HEADERS = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
};

const isPublic = (repo: Record<string, any> | null): repo is Record<string, any> =>
  !!repo && repo.is_private === false && repo.is_deleted !== true;

/** Totals over every public repo that is not deleted. */
badgeRoutes.get('/summary.svg', async (c) => {
  if (c.env.PUBLIC_BADGES !== 'true') return c.json({ error: 'Badges are disabled' }, 404);
  const { storage } = c.var;

  const [repos, traffic, releases] = await Promise.all([
    storage.repos.listRepos({ includeArchived: true, includePaused: true }),
    storage.traffic.getTotalsByRepo(TRAFFIC_DAYS),
    storage.signals.listSignals('release'),
  ]);
  const open = repos.filter(isPublic);
  const names = new Set(open.map((repo) => repo.full_name));
  const sum = (values: number[]) => values.reduce((total, value) => total + (Number(value) || 0), 0);

  const scored = open.filter((repo) => repo.last_health_check);
  const health = scored.length
    ? Math.round(sum(scored.map((repo) => computeHealthScore(repoRowToHealthInput(repo)).score)) / scored.length)
    : null;

  const title = (c.req.query('title') ?? '').trim().slice(0, 60) || 'Open source at a glance';
  const svg = renderSummaryCard(title, [
    { label: 'public repos', value: compactNumber(open.length) },
    { label: 'stars', value: compactNumber(sum(open.map((repo) => repo.stars))) },
    { label: 'lines of code', value: compactNumber(sum(open.map((repo) => repo.loc))) },
    { label: `views (${TRAFFIC_DAYS}d)`, value: compactNumber(sum(traffic.filter((row) => names.has(row.full_name)).map((row) => row.views))) },
    { label: 'release downloads', value: compactNumber(sum(releases.filter((signal) => names.has(signal.full_name)).map((signal) => signal.data.downloads))) },
    { label: 'average health', value: health === null ? '–' : `${health}/100` },
  ], cardTheme(c.req.query('theme')));
  return c.body(svg, 200, SVG_HEADERS);
});

async function repoCard(c: Context<HttpEnv>, fullName: string) {
  const repo = await c.var.storage.repos.getRepo(fullName);
  if (!isPublic(repo)) return c.json({ error: 'Badge not found' }, 404);

  const release = await releaseSignal(c.var.storage, fullName);
  const facts = [`★ ${compactNumber(repo.stars ?? 0)}`];
  if (repo.last_health_check) facts.push(`health ${computeHealthScore(repoRowToHealthInput(repo)).score}/100`);
  if (repo.test_coverage !== null && repo.test_coverage !== undefined) facts.push(`coverage ${repo.test_coverage}%`);
  if (release?.hasRelease) facts.push(String(release.tag));

  const svg = renderRepoCard({
    fullName, description: repo.description ?? null,
    language: repo.language ?? null, languageColor: LANGUAGE_COLORS[repo.language] ?? null, facts,
  }, cardTheme(c.req.query('theme')));
  return c.body(svg, 200, SVG_HEADERS);
}

badgeRoutes.get('/:owner/:repo/:file', async (c) => {
  if (c.env.PUBLIC_BADGES !== 'true') return c.json({ error: 'Badges are disabled' }, 404);

  const { owner, repo: name, file } = c.req.param();
  if (file === 'card.svg') return repoCard(c, `${owner}/${name}`);
  const metricName = file.endsWith('.svg') ? file.slice(0, -4) : '';
  const metric: Metric | undefined = Object.hasOwn(METRICS, metricName) ? METRICS[metricName] : undefined;
  const repo = metric ? await c.var.storage.repos.getRepo(`${owner}/${name}`) : null;
  if (!metric || !isPublic(repo)) {
    return c.json({ error: 'Badge not found' }, 404);
  }

  const badge = await metric(repo, c.var.storage);
  const label = (c.req.query('label') ?? '').trim().slice(0, 40) || badge.label;
  const style: BadgeStyle = c.req.query('style') === 'flat-square' ? 'flat-square' : 'flat';
  return c.body(renderBadge(label, badge.value, badge.color, style), 200, SVG_HEADERS);
});
