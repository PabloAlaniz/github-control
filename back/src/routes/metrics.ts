import { Hono } from 'hono';
import type { HttpEnv } from '../http/context';
import { internalError } from '../lib/error-handler';
import { toRepoSnapshot } from '../lib/metrics/transformers';
import { toCompareEntry } from '../lib/metrics/comparator';

export const metricsRoutes = new Hono<HttpEnv>();

// Get historical metrics for a specific repo
metricsRoutes.get('/repo/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;
  const days = parseInt(c.req.query('days') || '30');

  try {
    const rows = await c.var.storage.metrics.getRepoMetrics(fullName, days);
    return c.json({ repo: fullName, days, snapshots: rows.map(toRepoSnapshot) });
  } catch (e: any) {
    return internalError(c, e, { snapshots: [] });
  }
});

// Get metrics for all repos for a given date
metricsRoutes.get('/snapshot/:date', async (c) => {
  const date = c.req.param('date');

  try {
    const rows = await c.var.storage.metrics.getSnapshot(date);
    return c.json({
      date,
      repos: rows.map((row: any) => ({
        fullName: row.full_name,
        ...toRepoSnapshot(row),
        meta: { language: row.language, isPrivate: row.is_private, isArchived: row.is_archived },
      })),
    });
  } catch (e: any) {
    return internalError(c, e, { repos: [] });
  }
});

// Get aggregate metrics over time (all repos)
metricsRoutes.get('/aggregate', async (c) => {
  const days = parseInt(c.req.query('days') || '30');

  try {
    const rows = await c.var.storage.metrics.getAggregate(days);

    return c.json({
      days,
      snapshots: rows.map((row: any) => ({
        date: row.snapshot_date,
        totalRepos: parseInt(row.total_repos),
        code: { totalLoc: parseInt(row.total_loc || '0'), totalFiles: parseInt(row.total_files || '0'), totalSizeKb: parseInt(row.total_size_kb || '0') },
        github: { totalStars: parseInt(row.total_stars || '0'), totalForks: parseInt(row.total_forks || '0'), totalOpenIssues: parseInt(row.total_open_issues || '0') },
        health: {
          reposWithCi: parseInt(row.repos_with_ci || '0'), reposWithTests: parseInt(row.repos_with_tests || '0'), reposWithReadme: parseInt(row.repos_with_readme || '0'),
          docsQuality: { excellent: parseInt(row.repos_docs_excellent || '0'), good: parseInt(row.repos_docs_good || '0'), needsWork: parseInt(row.repos_docs_needs_work || '0'), missing: parseInt(row.repos_docs_missing || '0') },
        },
      })),
    });
  } catch (e: any) {
    return internalError(c, e, { snapshots: [] });
  }
});

// Get latest snapshot (most recent date)
metricsRoutes.get('/latest', async (c) => {
  try {
    return c.json({ latestSnapshot: await c.var.storage.metrics.getLatestSnapshotDate() });
  } catch (e: any) {
    return internalError(c, e, { latestSnapshot: null });
  }
});

// Compare two dates (diff metrics)
metricsRoutes.get('/compare', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  if (!from || !to) return c.json({ error: 'Missing required query params: from, to' }, 400);

  try {
    const rows = await c.var.storage.metrics.compareSnapshots(from, to);
    return c.json({ from, to, changes: rows.map(toCompareEntry) });
  } catch (e: any) {
    return internalError(c, e, { changes: [] });
  }
});
