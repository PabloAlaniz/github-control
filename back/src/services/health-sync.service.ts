import type { AppContext } from '../application/context';
import { ACTIONS } from '../domain/activity';
import { getOctokit, getRepoReadme, computeCodeMetrics, countLocFromTarball } from '../lib/github';
import type { TarballLocResult } from '../lib/github';
import { runPipeline, runAppPipeline } from '../lib/analyzers/pipeline';
import { calculateDocsQuality } from '../lib/github/detection';
import { enrichFromGitHub } from '../lib/analyzers/github-enricher';
import type { PipelineResult } from '../lib/analyzers/types';
import type { SnapshotInput } from '../lib/metrics/types';
import { appSlugify } from '../lib/slugify';

export interface HealthSyncResult {
  health: Record<string, unknown>;
  metadata: { size_kb: number; topics: string[]; license: string | null; is_fork: boolean };
  apps: { detected: number; synced: number };
  codeMetrics: { loc: number; fileCount: number; source: 'tarball' | 'estimate' };
}

/** Max code files before skipping tarball LOC (fallback to estimation). */
const TARBALL_FILE_LIMIT = 2000;

/** Outer timeout for the entire tarball LOC operation (20 seconds). */
const TARBALL_OUTER_TIMEOUT_MS = 20_000;

/** Race a promise against a timeout — rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer!));
}

/**
 * Full repo health sync using the unified analyzer pipeline.
 * Computes LOC via hybrid approach: tarball (exact) with byte-estimation fallback.
 */
export async function syncRepoHealth(
  ctx: AppContext,
  owner: string,
  repo: string,
  actor: { type: string; name: string } = { type: 'user', name: 'manual_sync' },
): Promise<HealthSyncResult> {
  const fullName = `${owner}/${repo}`;

  const row = await ctx.storage.repos.getLanguage(fullName);
  if (!row) throw new NotFoundError('Repo not found in database');

  // Fetch file tree from GitHub API (paths source for analyzers)
  const octokit = getOctokit(ctx.config);
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const { data: treeData } = await octokit.git.getTree({
    owner, repo, tree_sha: repoData.default_branch, recursive: 'true',
  });
  const tree = treeData.tree;
  const paths = tree.map(item => item.path || '');

  // Run the unified pipeline (same functions as batch sync)
  const result = await runPipeline({
    paths,
    language: repoData.language,
  });

  // In API mode (no cloneDir), supplement README line count from GitHub API
  if (result.hasReadme && result.readmeLines === 0) {
    const readme = await getRepoReadme(ctx.config, owner, repo);
    if (readme) {
      result.readmeLines = readme.content.split('\n').length;
      result.docsQuality = calculateDocsQuality(result.hasReadme, result.readmeLines, result.docsFileCount);
    }
  }

  // Enrich with GitHub API metadata
  const metadata = await enrichFromGitHub(octokit, owner, repo);

  // ── Code metrics: hybrid (tarball + byte estimation fallback) ──
  const estimation = computeCodeMetrics(tree);
  let loc = estimation.estimatedLoc;
  let fileCount = estimation.fileCount;
  let locSource: 'tarball' | 'estimate' = 'estimate';
  let tarballResult: TarballLocResult | null = null;

  // Collect app prefixes for tarball scoping
  const appPrefixes = (result.isMonorepo && result.apps.length > 0)
    ? result.apps.map(a => a.appPath)
    : undefined;

  if (estimation.fileCount <= TARBALL_FILE_LIMIT) {
    try {
      tarballResult = await withTimeout(
        countLocFromTarball(ctx.config.GITHUB_TOKEN, owner, repo, repoData.default_branch, appPrefixes),
        TARBALL_OUTER_TIMEOUT_MS,
        'Tarball LOC',
      );
      loc = tarballResult.total.loc;
      fileCount = tarballResult.total.fileCount;
      locSource = 'tarball';
    } catch (err: any) {
      console.warn(`Tarball LOC failed for ${fullName}, using byte estimation:`, err.message);
    }
  }

  // Update repo health (pipeline results + code metrics)
  await ctx.storage.health.updateRepoHealth(fullName, result, result.stack, result.docsQuality, {
    size: metadata.repo_size_kb,
    default_branch: metadata.default_branch,
    topics: metadata.topics,
    license: metadata.license_key ? { key: metadata.license_key, name: metadata.license_name ?? '' } : null,
    homepage: metadata.homepage,
    fork: metadata.is_fork,
    parent: metadata.parent_repo ? { full_name: metadata.parent_repo } : null,
    has_issues: metadata.has_issues,
    has_projects: metadata.has_projects,
    has_wiki: metadata.has_wiki,
    has_pages: metadata.has_pages,
    has_discussions: metadata.has_discussions,
    subscribers_count: metadata.subscribers_count,
    is_template: metadata.is_template,
  }, loc, fileCount);

  // Write daily snapshot to repo_metrics_history (non-fatal)
  try {
    const snapshotInput: SnapshotInput = {
      repoId: row.id,
      fullName,
      code: { sizeKb: metadata.repo_size_kb, fileCount, loc },
      github: {
        stars: metadata.stars, forks: metadata.forks, watchers: metadata.watchers,
        subscribersCount: metadata.subscribers_count, openIssues: metadata.open_issues,
      },
      health: {
        hasCi: result.hasCi, hasTests: result.hasTests, hasReadme: result.hasReadme,
        readmeLines: result.readmeLines, hasGitignore: result.hasGitignore ?? false,
        hasRoadmap: result.hasRoadmap ?? false, docsFileCount: result.docsFileCount ?? 0,
        docsQuality: result.docsQuality ?? 'missing',
      },
      meta: {
        language: metadata.language, isPrivate: metadata.is_private,
        isArchived: metadata.is_archived, isFork: metadata.is_fork,
        isTemplate: metadata.is_template, defaultBranch: metadata.default_branch,
      },
    };
    await ctx.storage.metrics.upsertSnapshot(snapshotInput);
  } catch (snapshotErr: any) {
    console.warn(`Snapshot write failed for ${fullName}:`, snapshotErr.message);
  }

  await ctx.storage.activity.logActivity({
    action: ACTIONS.HEALTH_UPDATE,
    entityType: 'repo',
    entityId: fullName,
    fieldChanged: 'health_metrics',
    newValue: `Synced health, metadata, and code metrics (${locSource})`,
    actorType: actor.type,
    actorName: actor.name,
    metadata: {
      hasReadme: result.hasReadme, hasCi: result.hasCi, hasTests: result.hasTests,
      docsQuality: result.docsQuality, repoSizeKb: metadata.repo_size_kb,
      loc, fileCount, locSource,
    },
  });

  // Auto-detect and sync monorepo apps (non-fatal, per-app)
  const appsResult = { detected: 0, synced: 0 };
  if (result.isMonorepo && result.apps.length > 0) {
    appsResult.detected = result.apps.length;

    for (const app of result.apps) {
      try {
        const slug = appSlugify(fullName, app.appName);
        await ctx.storage.apps.upsertApp({
          repo_full_name: fullName,
          app_path: app.appPath,
          app_name: app.appName,
          slug,
          stack: app.stack || null,
          detection_source: app.detectionSource,
        });

        // Run per-app pipeline scoped to app path
        const appResult = await runAppPipeline({ paths, language: null }, app.appPath);

        // Use tarball metrics if available, otherwise byte estimation
        let appLoc: number;
        let appFileCount: number;
        if (tarballResult) {
          const appMetrics = tarballResult.byPrefix.get(app.appPath);
          appLoc = appMetrics?.loc ?? 0;
          appFileCount = appMetrics?.fileCount ?? 0;
        } else {
          const appEstimation = computeCodeMetrics(tree, app.appPath);
          appLoc = appEstimation.estimatedLoc;
          appFileCount = appEstimation.fileCount;
        }

        await ctx.storage.apps.updateAppHealth(slug, {
          hasCi: appResult.hasCi ?? false,
          hasTests: appResult.hasTests ?? false,
          hasReadme: appResult.hasReadme ?? false,
          readmeLines: appResult.readmeLines ?? 0,
          loc: appLoc,
          fileCount: appFileCount,
          stack: appResult.stack ?? null,
          docsQuality: appResult.docsQuality ?? 'missing',
        }, {
          hasUnitTests: appResult.hasUnitTests ?? false,
          hasIntegrationTests: appResult.hasIntegrationTests ?? false,
          hasE2eTests: appResult.hasE2eTests ?? false,
          hasLintConfig: appResult.hasLintConfig ?? false,
          hasTypeChecking: appResult.hasTypeChecking ?? false,
          hasSecurityScan: appResult.hasSecurityScan ?? false,
          hasPerfTests: appResult.hasPerfTests ?? false,
          testFramework: appResult.testFramework ?? null,
          e2eFramework: appResult.e2eFramework ?? null,
          lintTool: appResult.lintTool ?? null,
        });
        appsResult.synced++;
      } catch (appError: any) {
        console.warn(`App sync failed for ${fullName}/${app.appName}:`, appError.message);
      }
    }

    // Prune apps no longer detected in the repo
    const detectedSlugs = result.apps.map(a => appSlugify(fullName, a.appName));
    try {
      await ctx.storage.apps.deleteStaleApps(fullName, detectedSlugs);
    } catch (err: any) {
      console.warn(`Stale app cleanup failed for ${fullName}:`, err.message);
    }
  }

  return {
    health: { ...result, stack: result.stack, docsQuality: result.docsQuality },
    metadata: {
      size_kb: metadata.repo_size_kb,
      topics: metadata.topics,
      license: metadata.license_key,
      is_fork: metadata.is_fork,
    },
    apps: appsResult,
    codeMetrics: { loc, fileCount, source: locSource },
  };
}

/** Sync health for a single app (used by repo-apps routes). */
export async function syncAppHealth(
  ctx: AppContext,
  owner: string,
  repo: string,
  appPath: string,
  slug: string,
  preloadedTree?: any[],
) {
  const octokit = getOctokit(ctx.config);

  // Get tree from preloaded data or fetch fresh
  let tree: Array<{ path?: string; type?: string; size?: number }>;
  let paths: string[];
  if (preloadedTree) {
    tree = preloadedTree;
    paths = preloadedTree.map((item: any) => item.path || '');
  } else {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: treeData } = await octokit.git.getTree({
      owner, repo, tree_sha: repoData.default_branch, recursive: 'true',
    });
    tree = treeData.tree;
    paths = tree.map(item => item.path || '');
  }

  // Run pipeline scoped to app path
  const appResult = await runAppPipeline({ paths, language: null }, appPath);

  // Use byte estimation for single-app sync (tarball only used in full repo sync)
  const appMetrics = computeCodeMetrics(tree, appPath);

  const health = {
    hasCi: appResult.hasCi ?? false,
    hasTests: appResult.hasTests ?? false,
    hasReadme: appResult.hasReadme ?? false,
    readmeLines: appResult.readmeLines ?? 0,
    loc: appMetrics.estimatedLoc,
    fileCount: appMetrics.fileCount,
    stack: appResult.stack ?? null,
    docsQuality: appResult.docsQuality ?? 'missing',
  };

  await ctx.storage.apps.updateAppHealth(slug, health, {
    hasUnitTests: appResult.hasUnitTests ?? false,
    hasIntegrationTests: appResult.hasIntegrationTests ?? false,
    hasE2eTests: appResult.hasE2eTests ?? false,
    hasLintConfig: appResult.hasLintConfig ?? false,
    hasTypeChecking: appResult.hasTypeChecking ?? false,
    hasSecurityScan: appResult.hasSecurityScan ?? false,
    hasPerfTests: appResult.hasPerfTests ?? false,
    testFramework: appResult.testFramework ?? null,
    e2eFramework: appResult.e2eFramework ?? null,
    lintTool: appResult.lintTool ?? null,
  });

  return health;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
