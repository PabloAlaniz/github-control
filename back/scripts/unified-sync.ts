#!/usr/bin/env npx tsx

/**
 * Unified Sync Orchestrator
 *
 * Single entry point that replaces 5 existing scripts:
 *   - daily-snapshot-clone.js   (clone + LOC)
 *   - daily-snapshot.js         (snapshot insertion)
 *   - sync-github.js            (GitHub API enrichment)
 *   - count-loc.js              (LOC counting)
 *   - run-daily-snapshot-rust.sh (Rust binary wrapper)
 *
 * Three phases:
 *   1. Rust clone/cache (optional) - runs the existing Rust binary for LOC/size
 *   2. Node analyzers              - reads file manifests from cache, runs all micro-analyzers
 *   3. GitHub API enrich           - fetches metadata not available from clone (stars, forks, etc.)
 *
 * Usage:
 *   npx tsx back/scripts/unified-sync.ts
 *   npx tsx back/scripts/unified-sync.ts --analyze-only --limit 5
 *   npx tsx back/scripts/unified-sync.ts --repo Owner/Repo --no-rust
 *   npx tsx back/scripts/unified-sync.ts --run-coverage --coverage-timeout 180000
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { Octokit } from '@octokit/rest';
import pLimit from 'p-limit';

import { runPipeline, runAppPipeline } from '../src/lib/analyzers/pipeline.js';
import type { AnalyzerInput, PipelineResult, MonorepoApp } from '../src/lib/analyzers/types.js';
import { enrichFromGitHub } from '../src/lib/analyzers/github-enricher.js';
import type { GitHubMetadata } from '../src/lib/analyzers/github-enricher.js';
import { appSlugify } from '../src/lib/slugify.js';
import type { SnapshotInput } from '../src/lib/metrics/types.js';
import { UPSERT_SNAPSHOT_SQL, snapshotParams } from '../src/lib/metrics/snapshot-sql.js';

const { Client } = pg;

// ---------------------------------------------------------------------------
// __dirname shim for ESM
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigFile {
  DATABASE_URL: string;
  GITHUB_TOKEN: string;
}

interface ParsedArgs {
  analyzeOnly: boolean;
  repo: string | null;
  limit: number | null;
  refresh: boolean;
  noRust: boolean;
  runCoverage: boolean;
  coverageTimeout: number;
  apiDelay: number;
  cacheDir: string;
  profile: boolean;
}

interface RepoRow {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  language: string | null;
  stars: number;
  forks: number;
  watchers: number;
  subscribers_count: number;
  open_issues: number;
  has_ci: boolean;
  has_tests: boolean;
  has_readme: boolean;
  readme_lines: number;
  has_gitignore: boolean;
  has_roadmap: boolean;
  docs_file_count: number;
  docs_quality: string | null;
  is_private: boolean;
  is_archived: boolean;
  is_fork: boolean;
  is_template: boolean;
  default_branch: string;
  repo_size_kb: number | null;
  file_count: number | null;
  loc: number | null;
}

interface ProfileTiming {
  rustPhaseMs: number;
  analyzerMs: number;
  githubEnrichMs: number;
  dbWriteMs: number;
  totalReposAnalyzed: number;
  totalReposEnriched: number;
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);

  function flagValue(flag: string): string | null {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return null;
    return argv[idx + 1];
  }

  function hasFlag(flag: string): boolean {
    return argv.includes(flag);
  }

  return {
    analyzeOnly: hasFlag('--analyze-only'),
    repo: flagValue('--repo'),
    limit: flagValue('--limit') ? parseInt(flagValue('--limit')!, 10) : null,
    refresh: hasFlag('--refresh'),
    noRust: hasFlag('--no-rust'),
    runCoverage: hasFlag('--run-coverage'),
    coverageTimeout: parseInt(flagValue('--coverage-timeout') ?? '120000', 10),
    apiDelay: parseInt(flagValue('--api-delay') ?? '200', 10),
    cacheDir: flagValue('--cache-dir') ?? join(homedir(), '.cache', 'github-control-snapshot'),
    profile: hasFlag('--profile'),
  };
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

function loadConfig(): ConfigFile {
  const configPath = join(__dirname, '..', 'config', 'snapshot.json');
  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    console.error('Create it from config/snapshot.json.example');
    process.exit(1);
  }

  let config: ConfigFile;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err: any) {
    console.error(`Failed to parse config: ${err.message}`);
    process.exit(1);
  }

  if (!config.DATABASE_URL || !config.GITHUB_TOKEN) {
    console.error('config/snapshot.json must contain DATABASE_URL and GITHUB_TOKEN');
    process.exit(1);
  }

  return config;
}

// ---------------------------------------------------------------------------
// Sleep utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// File listing fallback (when no .file_manifest.json exists)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', '.next', '.cache',
  'coverage', '__pycache__', 'public/assets',
]);

function listFilesRecursive(dir: string, base: string = dir): string[] {
  const files: string[] = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...listFilesRecursive(join(dir, entry.name), base));
    } else {
      files.push(relative(base, join(dir, entry.name)));
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Phase 1: Rust clone/cache
// ---------------------------------------------------------------------------

function runRustPhase(cacheDir: string, _config: ConfigFile, args: ParsedArgs): void {
  console.log('Phase 1: Running Rust clone/cache...');
  const rustDir = join(__dirname, 'daily-snapshot-clone-rust');

  if (!existsSync(join(rustDir, 'Cargo.toml'))) {
    console.error(`  Rust project not found at ${rustDir}`);
    console.error('  Use --no-rust or --analyze-only to skip this phase');
    process.exit(1);
  }

  // Ensure cache directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Arguments are passed as an array without a shell, so paths with spaces or
  // shell metacharacters can't break the command or inject new ones.
  const cargoArgs = [
    'run', '--release',
    '--manifest-path', join(rustDir, 'Cargo.toml'),
    '--', '--cache-dir', cacheDir,
  ];
  if (args.limit) cargoArgs.push('--limit', String(args.limit));
  if (args.profile) cargoArgs.push('--profile');

  try {
    execFileSync('cargo', cargoArgs, {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: join(__dirname, '..'),
      timeout: 600_000, // 10 minute timeout for Rust phase
    });
    console.log('Phase 1: Rust clone/cache complete.\n');
  } catch (err: any) {
    console.error(`Phase 1 failed: ${err.message}`);
    console.error('Continuing with existing cache data...\n');
  }
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

async function getAllRepos(db: pg.Client): Promise<RepoRow[]> {
  const result = await db.query(`
    SELECT id, full_name, owner, name, language, stars, forks, watchers, subscribers_count,
      open_issues, has_ci, has_tests, has_readme, readme_lines, has_gitignore, has_roadmap,
      docs_file_count, docs_quality, is_private, is_archived, is_fork, is_template,
      default_branch, repo_size_kb, file_count, loc
    FROM repos WHERE is_archived = false ORDER BY full_name
  `);
  return result.rows;
}

async function updateRepoFromPipeline(
  db: pg.Client,
  fullName: string,
  result: PipelineResult,
): Promise<void> {
  await db.query(
    `UPDATE repos SET
      has_ci = $1, has_tests = $2, has_readme = $3, has_gitignore = $4,
      readme_lines = $5, stack = $6, has_roadmap = $7, docs_quality = $8, docs_file_count = $9,
      has_unit_tests = $10, has_integration_tests = $11, has_e2e_tests = $12,
      has_lint_config = $13, has_type_checking = $14, has_security_scan = $15, has_perf_tests = $16,
      test_framework = $17, e2e_framework = $18, lint_tool = $19,
      last_health_check = NOW()
    WHERE full_name = $20`,
    [
      result.hasCi,
      result.hasTests,
      result.hasReadme,
      result.hasGitignore,
      result.readmeLines,
      result.stack,
      result.hasRoadmap,
      result.docsQuality,
      result.docsFileCount,
      result.hasUnitTests,
      result.hasIntegrationTests,
      result.hasE2eTests,
      result.hasLintConfig,
      result.hasTypeChecking,
      result.hasSecurityScan,
      result.hasPerfTests,
      result.testFramework,
      result.e2eFramework,
      result.lintTool,
      fullName,
    ],
  );
}

async function updateRepoFromGitHub(
  db: pg.Client,
  fullName: string,
  meta: GitHubMetadata,
): Promise<void> {
  await db.query(
    `UPDATE repos SET
      stars = $1, forks = $2, watchers = $3, subscribers_count = $4, open_issues = $5,
      description = $6, topics = $7, license_key = $8, license_name = $9, homepage = $10,
      is_fork = $11, parent_repo = $12, is_template = $13, is_private = $14,
      has_issues = $15, has_projects = $16, has_wiki = $17, has_pages = $18, has_discussions = $19,
      repo_size_kb = $20, last_commit_at = $21, repo_created_at = $22, repo_updated_at = $23,
      language = $24, default_branch = $25,
      github_cached_at = NOW()
    WHERE full_name = $26`,
    [
      meta.stars,
      meta.forks,
      meta.watchers,
      meta.subscribers_count,
      meta.open_issues,
      meta.description,
      JSON.stringify(meta.topics),
      meta.license_key,
      meta.license_name,
      meta.homepage,
      meta.is_fork,
      meta.parent_repo,
      meta.is_template,
      meta.is_private,
      meta.has_issues,
      meta.has_projects,
      meta.has_wiki,
      meta.has_pages,
      meta.has_discussions,
      meta.repo_size_kb,
      meta.last_commit_at,
      meta.repo_created_at,
      meta.repo_updated_at,
      meta.language,
      meta.default_branch,
      fullName,
    ],
  );
}

async function insertSnapshot(
  db: pg.Client,
  repo: RepoRow,
  result: PipelineResult,
): Promise<void> {
  const input: SnapshotInput = {
    repoId: repo.id,
    fullName: repo.full_name,
    code: { sizeKb: repo.repo_size_kb, fileCount: repo.file_count, loc: repo.loc },
    github: {
      stars: repo.stars, forks: repo.forks, watchers: repo.watchers,
      subscribersCount: repo.subscribers_count, openIssues: repo.open_issues,
    },
    health: {
      hasCi: result.hasCi, hasTests: result.hasTests, hasReadme: result.hasReadme,
      readmeLines: result.readmeLines, hasGitignore: result.hasGitignore ?? false,
      hasRoadmap: result.hasRoadmap ?? false, docsFileCount: result.docsFileCount ?? 0,
      docsQuality: result.docsQuality ?? 'missing',
    },
    meta: {
      language: repo.language, isPrivate: repo.is_private, isArchived: repo.is_archived,
      isFork: repo.is_fork, isTemplate: repo.is_template, defaultBranch: repo.default_branch,
    },
  };
  await db.query(UPSERT_SNAPSHOT_SQL, snapshotParams(input));
}

async function upsertAppFromPipeline(
  db: pg.Client,
  repoFullName: string,
  app: MonorepoApp,
  appResult: Partial<PipelineResult>,
): Promise<void> {
  const slug = appSlugify(repoFullName, app.appName);

  await db.query(
    `INSERT INTO repo_apps (
      repo_full_name, app_path, app_name, slug, stack, detection_source,
      has_ci, has_tests, has_readme, readme_lines, loc, file_count, docs_quality,
      has_unit_tests, has_integration_tests, has_e2e_tests,
      has_lint_config, has_type_checking, has_security_scan, has_perf_tests,
      test_framework, e2e_framework, lint_tool,
      last_health_check
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13,
      $14, $15, $16,
      $17, $18, $19, $20,
      $21, $22, $23,
      NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      detection_source = EXCLUDED.detection_source,
      stack = COALESCE(EXCLUDED.stack, repo_apps.stack),
      has_ci = EXCLUDED.has_ci,
      has_tests = EXCLUDED.has_tests,
      has_readme = EXCLUDED.has_readme,
      readme_lines = EXCLUDED.readme_lines,
      loc = EXCLUDED.loc,
      file_count = EXCLUDED.file_count,
      docs_quality = EXCLUDED.docs_quality,
      has_unit_tests = EXCLUDED.has_unit_tests,
      has_integration_tests = EXCLUDED.has_integration_tests,
      has_e2e_tests = EXCLUDED.has_e2e_tests,
      has_lint_config = EXCLUDED.has_lint_config,
      has_type_checking = EXCLUDED.has_type_checking,
      has_security_scan = EXCLUDED.has_security_scan,
      has_perf_tests = EXCLUDED.has_perf_tests,
      test_framework = EXCLUDED.test_framework,
      e2e_framework = EXCLUDED.e2e_framework,
      lint_tool = EXCLUDED.lint_tool,
      last_health_check = NOW()`,
    [
      repoFullName,
      app.appPath,
      app.appName,
      slug,
      appResult.stack ?? app.stack ?? null,
      app.detectionSource,
      appResult.hasCi ?? false,
      appResult.hasTests ?? false,
      appResult.hasReadme ?? false,
      appResult.readmeLines ?? 0,
      0, // LOC is tracked at the repo level by the Rust phase
      appResult.docsFileCount ?? 0,
      appResult.docsQuality ?? 'missing',
      appResult.hasUnitTests ?? false,
      appResult.hasIntegrationTests ?? false,
      appResult.hasE2eTests ?? false,
      appResult.hasLintConfig ?? false,
      appResult.hasTypeChecking ?? false,
      appResult.hasSecurityScan ?? false,
      appResult.hasPerfTests ?? false,
      appResult.testFramework ?? null,
      appResult.e2eFramework ?? null,
      appResult.lintTool ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();
  const args = parseArgs();
  const config = loadConfig();

  console.log(`[${new Date().toISOString()}] Unified Sync Orchestrator`);
  console.log(`  Cache dir : ${args.cacheDir}`);
  console.log(`  Rust phase: ${args.noRust || args.analyzeOnly ? 'SKIP' : 'ON'}`);
  console.log(`  Coverage  : ${args.runCoverage ? 'ON' : 'OFF'}`);
  console.log(`  API delay : ${args.apiDelay}ms`);
  if (args.repo) console.log(`  Filter    : ${args.repo}`);
  if (args.limit) console.log(`  Limit     : ${args.limit}`);
  console.log('');

  const timing: ProfileTiming = {
    rustPhaseMs: 0,
    analyzerMs: 0,
    githubEnrichMs: 0,
    dbWriteMs: 0,
    totalReposAnalyzed: 0,
    totalReposEnriched: 0,
  };

  const db = new Client({ connectionString: config.DATABASE_URL });
  await db.connect();

  try {
    // -----------------------------------------------------------------------
    // Phase 0: Optional refresh note
    // -----------------------------------------------------------------------
    if (args.refresh) {
      console.log('Note: --refresh requires calling POST /api/repos/refresh');
      console.log('      This flag is a reminder; the actual refresh happens via the API endpoint.\n');
    }

    // -----------------------------------------------------------------------
    // Phase 1: Rust clone/cache (optional)
    // -----------------------------------------------------------------------
    if (!args.noRust && !args.analyzeOnly) {
      const rustStart = Date.now();
      runRustPhase(args.cacheDir, config, args);
      timing.rustPhaseMs = Date.now() - rustStart;
    } else {
      console.log('Phase 1: Skipped (--no-rust or --analyze-only)\n');
    }

    // -----------------------------------------------------------------------
    // Get repos from DB and apply filters
    // -----------------------------------------------------------------------
    let repos = await getAllRepos(db);

    if (args.repo) {
      repos = repos.filter(r => r.full_name === args.repo);
      if (repos.length === 0) {
        console.error(`No repo found matching "${args.repo}"`);
        process.exit(1);
      }
    }
    if (args.limit) {
      repos = repos.slice(0, args.limit);
    }

    console.log(`Found ${repos.length} repositories to process.\n`);

    // -----------------------------------------------------------------------
    // Phase 2: Run analyzers (parallel, local filesystem)
    // -----------------------------------------------------------------------
    console.log(`Phase 2: Analyzing ${repos.length} repos...`);
    const analyzerStart = Date.now();
    const analyzerResults = new Map<string, PipelineResult>();
    const concurrencyLimit = pLimit(5);
    let analyzerErrors = 0;

    await Promise.all(
      repos.map((repo, i) =>
        concurrencyLimit(async () => {
          const cacheDir = join(args.cacheDir, repo.owner, repo.name);
          const manifestPath = join(cacheDir, '.file_manifest.json');

          // Determine file list
          let paths: string[];
          if (existsSync(manifestPath)) {
            try {
              paths = JSON.parse(readFileSync(manifestPath, 'utf-8'));
            } catch {
              console.warn(`  [${i + 1}/${repos.length}] ${repo.full_name} - bad manifest, falling back to directory listing`);
              paths = existsSync(cacheDir) ? listFilesRecursive(cacheDir) : [];
            }
          } else if (existsSync(cacheDir) && existsSync(join(cacheDir, '.git'))) {
            paths = listFilesRecursive(cacheDir);
          } else {
            console.warn(`  [${i + 1}/${repos.length}] ${repo.full_name} - no cache, skipping analyzers`);
            return;
          }

          if (paths.length === 0) {
            console.warn(`  [${i + 1}/${repos.length}] ${repo.full_name} - empty file list, skipping`);
            return;
          }

          const input: AnalyzerInput = {
            paths,
            language: repo.language,
            cloneDir: cacheDir,
            runCoverage: args.runCoverage,
            coverageTimeout: args.coverageTimeout,
          };

          try {
            // Run the full analyzer pipeline
            const result = await runPipeline(input);
            analyzerResults.set(repo.full_name, result);

            // Write analyzer results to repos table
            const dbStart = Date.now();
            await updateRepoFromPipeline(db, repo.full_name, result);

            // Handle monorepo apps
            if (result.isMonorepo && result.apps.length > 0) {
              for (const app of result.apps) {
                try {
                  const appResult = await runAppPipeline(input, app.appPath);
                  await upsertAppFromPipeline(db, repo.full_name, app, appResult);
                } catch (appErr: any) {
                  console.warn(`    App ${app.appName} analysis failed: ${appErr.message}`);
                }
              }
            }

            // Insert daily snapshot
            await insertSnapshot(db, repo, result);
            timing.dbWriteMs += Date.now() - dbStart;

            const appsInfo = result.apps.length > 0 ? ` | ${result.apps.length} apps` : '';
            console.log(`  [${i + 1}/${repos.length}] ${repo.full_name} ✓${appsInfo}`);
          } catch (err: any) {
            analyzerErrors++;
            console.error(`  [${i + 1}/${repos.length}] ${repo.full_name} ✗ ${err.message}`);
          }
        }),
      ),
    );

    timing.analyzerMs = Date.now() - analyzerStart;
    timing.totalReposAnalyzed = analyzerResults.size;

    console.log(
      `Phase 2 complete: ${analyzerResults.size} analyzed, ${analyzerErrors} errors\n`,
    );

    // -----------------------------------------------------------------------
    // Phase 3: GitHub API enrichment (serial, with rate-limit handling)
    // -----------------------------------------------------------------------
    console.log(`Phase 3: Enriching ${repos.length} repos from GitHub API...`);
    const enrichStart = Date.now();
    const octokit = new Octokit({ auth: config.GITHUB_TOKEN });
    let enrichErrors = 0;
    let enriched = 0;

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      try {
        const metadata = await enrichFromGitHub(octokit, repo.owner, repo.name);

        const dbStart = Date.now();
        await updateRepoFromGitHub(db, repo.full_name, metadata);
        timing.dbWriteMs += Date.now() - dbStart;

        enriched++;
        console.log(`  [${i + 1}/${repos.length}] ${repo.full_name} ✓`);
      } catch (err: any) {
        // Handle rate limiting with smart retry
        if (err.status === 403 || err.status === 429) {
          const resetHeader = err.response?.headers?.['x-ratelimit-reset'];
          let waitMs = 60_000; // default 60s

          if (resetHeader) {
            const resetEpochMs = parseInt(resetHeader, 10) * 1000;
            waitMs = Math.max(0, resetEpochMs - Date.now()) + 1000;
          }

          const waitSec = Math.ceil(waitMs / 1000);
          console.warn(`  Rate limited, waiting ${waitSec}s...`);
          await sleep(waitMs);
          i--; // retry this repo
          continue;
        }

        enrichErrors++;
        console.warn(`  [${i + 1}/${repos.length}] ${repo.full_name} ✗ ${err.message}`);
      }

      // Delay between API calls to stay within rate limits
      if (i < repos.length - 1) {
        await sleep(args.apiDelay);
      }
    }

    timing.githubEnrichMs = Date.now() - enrichStart;
    timing.totalReposEnriched = enriched;

    console.log(
      `Phase 3 complete: ${enriched} enriched, ${enrichErrors} errors\n`,
    );

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('='.repeat(60));
    console.log(`Done in ${totalDuration}s`);
    console.log(`  Repos analyzed : ${timing.totalReposAnalyzed}`);
    console.log(`  Repos enriched : ${timing.totalReposEnriched}`);
    console.log(`  Analyzer errors: ${analyzerErrors}`);
    console.log(`  Enrich errors  : ${enrichErrors}`);

    if (args.profile) {
      console.log('');
      console.log('  --- Timing breakdown ---');
      console.log(`  Rust phase    : ${(timing.rustPhaseMs / 1000).toFixed(2).padStart(8)}s`);
      console.log(`  Analyzers     : ${(timing.analyzerMs / 1000).toFixed(2).padStart(8)}s`);
      console.log(`  GitHub enrich : ${(timing.githubEnrichMs / 1000).toFixed(2).padStart(8)}s`);
      console.log(`  DB writes     : ${(timing.dbWriteMs / 1000).toFixed(2).padStart(8)}s`);
    }

    console.log('='.repeat(60));
  } finally {
    await db.end();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
