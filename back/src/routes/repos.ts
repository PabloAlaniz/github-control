import { Hono } from 'hono';
import { serviceContext, type HttpEnv } from '../http/context';
import { archiveRepo } from '../lib/github';
import { refreshFromGitHub } from '../services/repo-sync.service';
import { computeHealthScore, repoRowToHealthInput } from '../lib/analyzers/healthScore';
import { getLatestWorkflowRun, deriveCiStatus } from '../lib/github/workflows';
import { groupSignals } from '../services/signal.service';

export const reposRoutes = new Hono<HttpEnv>();

// List all repos (excludes deleted, archived, and paused by default)
reposRoutes.get('/', async (c) => {
  const rows = await c.var.storage.repos.listRepos({
    includeDeleted: c.req.query('include_deleted') === 'true',
    includeArchived: c.req.query('include_archived') === 'true',
    includePaused: c.req.query('include_paused') === 'true',
  });

  // Enrich repos with coverage_reports
  const coverageRows = await c.var.storage.repos.listAllCoverage();
  const coverageByRepo = new Map<string, { label: string; coverage: number }[]>();
  for (const row of coverageRows) {
    const list = coverageByRepo.get(row.repo_full_name) || [];
    list.push({ label: row.label, coverage: row.coverage });
    coverageByRepo.set(row.repo_full_name, list);
  }

  // Enrich repos with monorepo apps
  const appRows = await c.var.storage.repos.listAllAppsEnriched();
  const appsByRepo = new Map<string, any[]>();
  for (const app of appRows as any[]) {
    const list = appsByRepo.get(app.repo_full_name) || [];
    list.push(app);
    appsByRepo.set(app.repo_full_name, list);
  }

  // Enrich repos with bulk trend deltas (latest snapshot vs ~30d ago).
  // Soft-fail: if the metrics history table is empty, we skip the enrichment.
  const trendsByRepo = new Map<string, any>();
  try {
    const trendsRows = await c.var.storage.metrics.getBulkTrends(30);
    for (const t of trendsRows as any[]) {
      trendsByRepo.set(t.full_name, {
        period_days: t.period_days,
        loc_delta: t.loc_delta,
        stars_delta: t.stars_delta,
        open_issues_delta: t.open_issues_delta,
      });
    }
  } catch (err: any) {
    console.warn(`Bulk trends query failed: ${err.message}`);
  }

  // Enrich repos with the summary of their cached GitHub signals (standards, security, ...).
  const signalsByRepo = groupSignals(await c.var.storage.signals.listSignals(), { summary: true });

  const enriched = (rows as any[]).map(r => {
    const signals = signalsByRepo.get(r.full_name) || {};
    const health = computeHealthScore(repoRowToHealthInput({ ...r, signals }));
    return {
      ...r,
      signals,
      coverage_reports: coverageByRepo.get(r.full_name) || [],
      apps: appsByRepo.get(r.full_name) || [],
      is_monorepo: (appsByRepo.get(r.full_name) || []).length > 0,
      health_score: health,
      trend: trendsByRepo.get(r.full_name) || null,
    };
  });

  return c.json(enriched);
});

// Refresh from GitHub
reposRoutes.post('/refresh', async (c) => {
  if (!c.env.GITHUB_TOKEN) {
    return c.json({ error: 'GITHUB_TOKEN is not configured' }, 500);
  }

  try {
    const result = await refreshFromGitHub(serviceContext(c));
    return c.json(result);
  } catch (error: any) {
    return c.json({ error: `Failed to fetch repos from GitHub: ${error.message}` }, 500);
  }
});

// List deleted repos (soft-deleted)
reposRoutes.get('/deleted', async (c) => {
  const rows = await c.var.storage.repos.listDeleted();
  return c.json(rows);
});

// Purge deleted repos (hard delete)
reposRoutes.delete('/deleted/purge', async (c) => {
  const { full_name } = c.req.query();
  const deleted = await c.var.storage.repos.purgeDeleted(full_name);
  const purgedRepos = (deleted as any[]).map((r: any) => r.full_name);
  return c.json({
    purged: purgedRepos.length,
    ...(purgedRepos.length > 0 && { purgedRepos }),
  });
});

// Filter repos
reposRoutes.get('/filter', async (c) => {
  const rows = await c.var.storage.repos.filterRepos({
    stack: c.req.query('stack'),
    priority: c.req.query('priority'),
    has_ci: c.req.query('has_ci'),
    has_tests: c.req.query('has_tests'),
    has_readme: c.req.query('has_readme'),
    has_roadmap: c.req.query('has_roadmap'),
    archived: c.req.query('archived'),
    deleted: c.req.query('deleted'),
    paused: c.req.query('paused'),
  });
  return c.json(rows);
});

// List all high-priority repos
reposRoutes.get('/allowed', async (c) => {
  const rows = await c.var.storage.repos.listAllowed();
  return c.json({ count: rows.length, repos: rows.map(r => r.full_name) });
});

// Get single repo
reposRoutes.get('/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  const row = await c.var.storage.repos.getRepo(`${owner}/${repo}`);
  if (!row) return c.json({ error: 'Repo not found' }, 404);
  return c.json(row);
});

// Archive repo
reposRoutes.post('/:owner/:repo/archive', async (c) => {
  const { owner, repo } = c.req.param();
  await archiveRepo(c.env, owner, repo);
  await c.var.storage.repos.updateArchived(`${owner}/${repo}`);
  return c.json({ success: true });
});

// Update status
reposRoutes.post('/:owner/:repo/status', async (c) => {
  const { owner, repo } = c.req.param();
  const { status } = await c.req.json();
  await c.var.storage.repos.updateStatus(`${owner}/${repo}`, status);
  return c.json({ success: true });
});

// Delete repo from DB
reposRoutes.delete('/:owner/:repo', async (c) => {
  const { owner, repo } = c.req.param();
  await c.var.storage.repos.deleteRepo(`${owner}/${repo}`);
  return c.json({ success: true });
});

// Priority update
reposRoutes.post('/:owner/:repo/priority', async (c) => {
  const { owner, repo } = c.req.param();
  const { priority } = await c.req.json();
  await c.var.storage.repos.updatePriority(`${owner}/${repo}`, priority);
  return c.json({ success: true });
});

// Add blocker
reposRoutes.post('/:owner/:repo/blockers', async (c) => {
  const { owner, repo } = c.req.param();
  const { blocker } = await c.req.json();
  await c.var.storage.repos.addBlocker(`${owner}/${repo}`, blocker);
  return c.json({ success: true });
});

// Remove blocker
reposRoutes.delete('/:owner/:repo/blockers', async (c) => {
  const { owner, repo } = c.req.param();
  const { blocker } = await c.req.json();
  await c.var.storage.repos.removeBlocker(`${owner}/${repo}`, blocker);
  return c.json({ success: true });
});

// Sync CI status (latest workflow run) for a single repo
reposRoutes.post('/:owner/:repo/ci-status/sync', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;
  try {
    const run = await getLatestWorkflowRun(c.env, owner, repo);
    const status = deriveCiStatus(run);
    await c.var.storage.health.updateCiStatus(fullName, {
      ci_status: status,
      ci_status_url: run?.html_url ?? null,
      ci_status_run_at: run?.run_at ?? null,
    });
    return c.json({
      ok: true,
      repo: fullName,
      ci_status: status,
      ci_status_url: run?.html_url ?? null,
      ci_status_run_at: run?.run_at ?? null,
      run_name: run?.name ?? null,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Health score for a single repo (with full breakdown)
reposRoutes.get('/:owner/:repo/health-score', async (c) => {
  const { owner, repo } = c.req.param();
  const row = await c.var.storage.repos.getRepo(`${owner}/${repo}`);
  if (!row) return c.json({ error: 'Repo not found' }, 404);
  const fullName = `${owner}/${repo}`;
  const signals = groupSignals(await c.var.storage.signals.getRepoSignals(fullName)).get(fullName) ?? {};
  const result = computeHealthScore(repoRowToHealthInput({ ...(row as Record<string, any>), signals }));
  return c.json({
    repo: fullName,
    ...result,
    computed_at: new Date().toISOString(),
  });
});

// Validate repo priority (for agent gating)
reposRoutes.get('/:owner/:repo/validate', async (c) => {
  const { owner, repo } = c.req.param();
  const fullName = `${owner}/${repo}`;

  const row = await c.var.storage.repos.getRepoForValidation(fullName);
  if (!row) {
    return c.json({ repo: fullName, found: false, allowed: false, reason: 'Repo not found in database' });
  }

  const isHighPriority = row.priority === 'high';
  const isArchived = row.is_archived === true;
  const isDeleted = row.is_deleted === true;
  const allowed = isHighPriority && !isArchived && !isDeleted;

  let reason: string | null = null;
  if (!allowed) {
    if (isDeleted) reason = 'Repo is deleted';
    else if (isArchived) reason = 'Repo is archived';
    else if (!isHighPriority) reason = `Priority is '${row.priority || 'unset'}', only 'high' is allowed`;
  }

  return c.json({ repo: fullName, found: true, priority: row.priority, allowed, reason });
});
