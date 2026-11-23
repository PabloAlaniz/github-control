#!/usr/bin/env node

/**
 * Daily Snapshot (standalone clone variant)
 *
 * Usa git clone + análisis local. Cero llamadas REST.
 * Requiere: git instalado.
 *
 * Para programarlo, agregá una línea a tu crontab que ejecute este archivo
 * (el servidor Node ya trae su propio sync programado; esto es solo para
 * despliegues en Cloudflare Workers).
 *
 * Usage:
 *   node snapshot.js              # todos, 3 en paralelo
 *   node snapshot.js --limit 5    # probar con 5
 *   node snapshot.js -c 5         # 5 clones en paralelo
 *
 * Config (config.json): DATABASE_URL, GITHUB_TOKEN (PAT con scope `repo`).
 * verifyToken() aborta al arrancar si el token está expirado (HTTP 401).
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import pLimit from 'p-limit';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null;
const concIdx = args.findIndex(a => a === '-c' || a === '--concurrency');
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) || 3 : 3;
const PROFILE = args.includes('--profile');
const repoIdx = args.indexOf('--repo');
const REPO_FILTER = repoIdx >= 0 ? args[repoIdx + 1] : null;

const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}

const { DATABASE_URL, GITHUB_TOKEN } = config;
if (!DATABASE_URL || !GITHUB_TOKEN) {
  console.error('config.json needs DATABASE_URL and GITHUB_TOKEN');
  process.exit(1);
}

const { Client } = pg;
const db = new Client({ connectionString: DATABASE_URL });

// Mismo criterio que cloudflare/src/lib/github.ts
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.java', '.rb', '.php',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.rs', '.sql',
  '.sh', '.bash', '.yml', '.yaml', '.json', '.md'
]);

const EXCLUDED_DIRS = [
  'node_modules', 'vendor', 'dist', 'build', '.git', '.github',
  'coverage', '__pycache__', '.next', '.cache', 'public/assets'
];

function isCodeFile(filePath) {
  const ext = path.extname(filePath)?.toLowerCase() || '';
  return CODE_EXTENSIONS.has(ext);
}

function isExcludedPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return EXCLUDED_DIRS.some(dir =>
    normalized.includes(`/${dir}/`) || normalized.startsWith(`${dir}/`)
  );
}

function countLocAndFiles(dir, baseDir = dir) {
  let totalLines = 0;
  let fileCount = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(baseDir, full);
    if (e.isDirectory()) {
      if (EXCLUDED_DIRS.includes(e.name)) continue;
      const sub = countLocAndFiles(full, baseDir);
      totalLines += sub.lines;
      fileCount += sub.files;
    } else if (e.isFile() && isCodeFile(e.name) && !isExcludedPath(rel)) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        totalLines += content.split('\n').length;
        fileCount++;
      } catch {
        // skip binary / utf8 errors
      }
    }
  }
  return { lines: totalLines, files: fileCount };
}

// --- Monorepo app detection (filesystem-based) ---

function detectAppsFromDisk(cloneDir) {
  const apps = [];

  // 1. Try pnpm-workspace.yaml
  let workspacePatterns = [];
  const pnpmPath = path.join(cloneDir, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmPath)) {
    const content = fs.readFileSync(pnpmPath, 'utf8');
    const matches = content.match(/- ["']?([^"'\n]+)["']?/g);
    if (matches) {
      workspacePatterns = matches.map(m => m.replace(/- ["']?/, '').replace(/["']$/, '').trim());
    }
  }

  // 2. Fallback to package.json workspaces
  if (workspacePatterns.length === 0) {
    const pkgPath = path.join(cloneDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (Array.isArray(pkg.workspaces)) {
          workspacePatterns = pkg.workspaces;
        } else if (pkg.workspaces?.packages) {
          workspacePatterns = pkg.workspaces.packages;
        }
      } catch { /* invalid JSON */ }
    }
  }

  // 3. Resolve patterns: list subdirs under each base
  const detectionSource = workspacePatterns.length > 0 ? 'pnpm_workspace' : null;
  for (const pattern of workspacePatterns) {
    const base = pattern.replace(/\/?\*$/, '');
    const baseDir = path.join(cloneDir, base);
    if (!fs.existsSync(baseDir)) continue;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          apps.push({
            app_path: `${base}/${e.name}`,
            app_name: e.name,
            detection_source: detectionSource,
          });
        }
      }
    } catch { /* can't read dir */ }
  }

  // 4. Standalone root-level apps (dirs with their own config files)
  const skipDirs = new Set(['apps', 'packages', '.github', 'docs', 'node_modules', '.git', 'scripts', 'config']);
  const detectedPaths = new Set(apps.map(a => a.app_path));
  try {
    const entries = fs.readdirSync(cloneDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || skipDirs.has(e.name)) continue;
      if (detectedPaths.has(e.name)) continue;

      const configFiles = ['package.json', 'pyproject.toml', 'setup.py', 'go.mod', 'Cargo.toml'];
      for (const cf of configFiles) {
        if (fs.existsSync(path.join(cloneDir, e.name, cf))) {
          let stack;
          if (cf === 'package.json') stack = 'node';
          else if (cf === 'pyproject.toml' || cf === 'setup.py') stack = 'python';
          else if (cf === 'go.mod') stack = 'go';
          else if (cf === 'Cargo.toml') stack = 'rust';

          apps.push({
            app_path: e.name,
            app_name: e.name,
            detection_source: 'auto',
            stack,
          });
          break;
        }
      }
    }
  } catch { /* root listing failed */ }

  return apps;
}

function checkAppHealthFromDisk(cloneDir, appPath) {
  const appDir = path.join(cloneDir, appPath);

  // README
  const readmePath = path.join(appDir, 'README.md');
  const hasReadme = fs.existsSync(readmePath);
  let readmeLines = 0;
  if (hasReadme) {
    try { readmeLines = fs.readFileSync(readmePath, 'utf8').split('\n').length; } catch {}
  }

  // Tests
  const testDirs = ['test', 'tests', 'spec', '__tests__', 'src/test', 'src/tests'];
  const hasTests = testDirs.some(tp => fs.existsSync(path.join(appDir, tp)));

  // CI — check .github/workflows/*.yml for appPath reference
  let hasCi = false;
  const wfDir = path.join(cloneDir, '.github', 'workflows');
  if (fs.existsSync(wfDir)) {
    try {
      for (const f of fs.readdirSync(wfDir)) {
        if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
        const content = fs.readFileSync(path.join(wfDir, f), 'utf8');
        if (content.includes(appPath)) { hasCi = true; break; }
      }
    } catch {}
  }

  // Stack detection
  let stack = null;
  if (fs.existsSync(path.join(appDir, 'package.json'))) stack = 'node';
  else if (['pyproject.toml', 'setup.py', 'requirements.txt'].some(f => fs.existsSync(path.join(appDir, f)))) stack = 'python';
  else if (fs.existsSync(path.join(appDir, 'go.mod'))) stack = 'go';
  else if (fs.existsSync(path.join(appDir, 'Cargo.toml'))) stack = 'rust';

  // LOC/files — reuse existing countLocAndFiles scoped to app dir
  const { lines: loc, files: fileCount } = fs.existsSync(appDir)
    ? countLocAndFiles(appDir)
    : { lines: 0, files: 0 };

  // Docs quality (same formula as cloudflare/src/lib/github.ts calculateDocsQuality)
  const docsQuality = !hasReadme ? 'missing'
    : (readmeLines > 300 ? 'excellent' : readmeLines >= 50 ? 'good' : 'needs_work');

  return { hasReadme, readmeLines, hasCi, hasTests, stack, loc, fileCount, docsQuality };
}

function getDirSizeKb(dir) {
  try {
    const out = execSync(`du -sk "${dir}"`, { encoding: 'utf8' });
    return parseInt(out.split(/\s/)[0], 10);
  } catch {
    return null;
  }
}

async function query(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function getAllRepos() {
  return await query('SELECT * FROM repos WHERE is_archived = false ORDER BY full_name');
}

async function cloneAndAnalyze(fullName, profileTiming) {
  const [owner, repo] = fullName.split('/');
  // Formato canónico: token como password (x-access-token como usuario). Con el token
  // como usuario suelto, git pide password en repos privados y en cron (sin TTY) muere
  // con "Device not configured".
  const cloneUrl = `https://x-access-token:${GITHUB_TOKEN}@github.com/${owner}/${repo}.git`;
  const workDir = path.join(tmpdir(), `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    let t0 = Date.now();
    execSync(`git clone --depth 1 --single-branch "${cloneUrl}" "${workDir}"`, {
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (profileTiming) {
      profileTiming.cloneMs += Date.now() - t0;
      profileTiming.cloneCount++;
    }

    t0 = Date.now();
    const { lines: loc, files: file_count } = countLocAndFiles(workDir);
    if (profileTiming) {
      profileTiming.locMs += Date.now() - t0;
      profileTiming.locCount++;
    }

    t0 = Date.now();
    const repo_size_kb = getDirSizeKb(workDir);
    if (profileTiming) {
      profileTiming.duMs += Date.now() - t0;
    }

    // Detect and analyze monorepo apps (before cleanup)
    const detectedApps = detectAppsFromDisk(workDir);
    const apps = detectedApps.map(app => ({
      ...app,
      ...checkAppHealthFromDisk(workDir, app.app_path),
    }));

    return { loc, file_count, repo_size_kb, apps };
  } catch (err) {
    // Propagar: que se cuente en errorCount y no inserte un snapshot N/A silencioso.
    throw new Error(`clone/analyze failed for ${fullName}: ${err.message || err}`);
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

async function insertSnapshot(repo, analysisResult) {
  const sql = `
    INSERT INTO repo_metrics_history (
      repo_id, full_name, snapshot_date,
      repo_size_kb, file_count, loc,
      stars, forks, watchers, subscribers_count, open_issues,
      has_ci, has_tests, has_readme, readme_lines, has_gitignore, has_roadmap, docs_file_count, docs_quality,
      language, is_private, is_archived, is_fork, is_template, default_branch
    ) VALUES (
      $1, $2, CURRENT_DATE,
      $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24
    )
    ON CONFLICT (repo_id, snapshot_date)
    DO UPDATE SET
      repo_size_kb = EXCLUDED.repo_size_kb,
      file_count = EXCLUDED.file_count,
      loc = EXCLUDED.loc,
      stars = EXCLUDED.stars,
      forks = EXCLUDED.forks,
      watchers = EXCLUDED.watchers,
      subscribers_count = EXCLUDED.subscribers_count,
      open_issues = EXCLUDED.open_issues,
      has_ci = EXCLUDED.has_ci,
      has_tests = EXCLUDED.has_tests,
      has_readme = EXCLUDED.has_readme,
      readme_lines = EXCLUDED.readme_lines,
      has_gitignore = EXCLUDED.has_gitignore,
      has_roadmap = EXCLUDED.has_roadmap,
      docs_file_count = EXCLUDED.docs_file_count,
      docs_quality = EXCLUDED.docs_quality,
      language = EXCLUDED.language,
      is_private = EXCLUDED.is_private,
      is_archived = EXCLUDED.is_archived,
      is_fork = EXCLUDED.is_fork,
      is_template = EXCLUDED.is_template,
      default_branch = EXCLUDED.default_branch
  `;

  await query(sql, [
    repo.id, repo.full_name,
    analysisResult?.repo_size_kb ?? repo.repo_size_kb,
    analysisResult?.file_count ?? repo.file_count,
    analysisResult?.loc ?? repo.loc,
    repo.stars, repo.forks, repo.watchers, repo.subscribers_count, repo.open_issues,
    repo.has_ci, repo.has_tests, repo.has_readme, repo.readme_lines, repo.has_gitignore, repo.has_roadmap, repo.docs_file_count, repo.docs_quality,
    repo.language, repo.is_private, repo.is_archived, repo.is_fork, repo.is_template, repo.default_branch
  ]);
}

async function persistApps(repoFullName, apps) {
  let synced = 0;
  for (const app of apps) {
    const slug = `${repoFullName.replace('/', '--')}--${app.app_name}`
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

    await query(`
      INSERT INTO repo_apps (repo_full_name, app_path, app_name, slug, stack, detection_source,
        has_ci, has_tests, has_readme, readme_lines, loc, file_count, docs_quality, last_health_check)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (slug) DO UPDATE SET
        detection_source = EXCLUDED.detection_source,
        stack = COALESCE(EXCLUDED.stack, repo_apps.stack),
        has_ci = EXCLUDED.has_ci, has_tests = EXCLUDED.has_tests,
        has_readme = EXCLUDED.has_readme, readme_lines = EXCLUDED.readme_lines,
        loc = EXCLUDED.loc, file_count = EXCLUDED.file_count,
        docs_quality = EXCLUDED.docs_quality, last_health_check = NOW()
    `, [repoFullName, app.app_path, app.app_name, slug, app.stack || null, app.detection_source,
        app.hasCi, app.hasTests, app.hasReadme, app.readmeLines,
        app.loc, app.fileCount, app.docsQuality]);

    synced++;
  }
  return synced;
}

async function updateRepoCodeMetrics(repo, result) {
  // Volcar las métricas de código a la tabla `repos` (la que ve la tabla
  // principal). El cron solo calcula loc/file_count/repo_size_kb; los flags de
  // health (CI/tests/README) los sigue llenando el health-sync del worker.
  if (!result) return;
  await query(`
    UPDATE repos
    SET loc = COALESCE($2, loc),
        file_count = COALESCE($3, file_count),
        repo_size_kb = COALESCE($4, repo_size_kb),
        updated_at = NOW()
    WHERE id = $1
  `, [repo.id, result.loc, result.file_count, result.repo_size_kb]);
}

async function processRepo(repo, profileTiming) {
  const result = await cloneAndAnalyze(repo.full_name, profileTiming);
  const t0 = profileTiming ? Date.now() : 0;
  await insertSnapshot(repo, result);
  await updateRepoCodeMetrics(repo, result);

  // Persist monorepo apps if detected
  let appsSynced = 0;
  if (result?.apps?.length > 0) {
    appsSynced = await persistApps(repo.full_name, result.apps);
  }

  if (profileTiming) {
    profileTiming.dbInsertMs += Date.now() - t0;
  }
  return { repo, result, appsSynced };
}

async function verifyToken() {
  // Falla ruidoso si el token está muerto: si no, los repos privados quedan en N/A
  // silencioso (clone falla por auth) y el resumen miente con "Errors: 0".
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'github-control-snapshot' },
    });
    if (res.status === 401) {
      console.error('✗ GITHUB_TOKEN inválido/expirado (HTTP 401) — regeneralo en config.json');
      process.exit(1);
    }
    if (!res.ok) {
      console.error(`✗ No se pudo validar GITHUB_TOKEN (HTTP ${res.status})`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`✗ Error validando GITHUB_TOKEN: ${err.message || err}`);
    process.exit(1);
  }
}

async function main() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Daily snapshot (clone) - ${CONCURRENCY} parallel, 0 API calls`);

  await verifyToken();

  try {
    await db.connect();

    let repos = await getAllRepos();
    if (REPO_FILTER) {
      repos = repos.filter(r => r.full_name.toLowerCase().includes(REPO_FILTER.toLowerCase()));
      console.log(`Found ${repos.length} repos matching "${REPO_FILTER}"`);
    } else if (LIMIT) {
      repos = repos.slice(0, LIMIT);
      console.log(`Found ${repos.length} repos (--limit ${LIMIT})`);
    } else {
      console.log(`Found ${repos.length} repositories`);
    }

    const limit = pLimit(CONCURRENCY);
    let completed = 0;
    let successCount = 0;
    let errorCount = 0;
    const profileTiming = PROFILE ? { cloneMs: 0, cloneCount: 0, locMs: 0, locCount: 0, duMs: 0, dbInsertMs: 0 } : null;

    const tasks = repos.map((repo, i) =>
      limit(async () => {
        try {
          const out = await processRepo(repo, profileTiming);
          successCount++;
          completed++;
          const appsInfo = out.appsSynced > 0 ? ` | ${out.appsSynced} apps synced` : '';
          console.log(`[${i + 1}/${repos.length}] ${repo.full_name} ✓ LOC: ${out.result?.loc ?? 'N/A'}, Files: ${out.result?.file_count ?? 'N/A'}, Size: ${out.result?.repo_size_kb ?? 'N/A'} KB${appsInfo}`);
          if (completed % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            const avg = elapsed / completed;
            const eta = Math.ceil(avg * (repos.length - completed));
            console.log(`  📊 ${successCount} success, ${errorCount} errors | ETA: ~${eta}s`);
          }
        } catch (err) {
          errorCount++;
          completed++;
          console.error(`[${i + 1}/${repos.length}] ${repo.full_name} ✗ ${err.message}`);
        }
      })
    );

    await Promise.all(tasks);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Done in ${duration}s | Success: ${successCount} | Errors: ${errorCount}`);
    if (profileTiming) {
      console.log('  --- Profiling (sum across all repos) ---');
      console.log(`  clone:     ${(profileTiming.cloneMs / 1000).toFixed(2).padStart(6)}s (${profileTiming.cloneCount} repos)`);
      console.log(`  count_loc: ${(profileTiming.locMs / 1000).toFixed(2).padStart(6)}s (${profileTiming.locCount} repos)`);
      console.log(`  du:        ${(profileTiming.duMs / 1000).toFixed(2).padStart(6)}s`);
      console.log(`  db_insert: ${(profileTiming.dbInsertMs / 1000).toFixed(2).padStart(6)}s`);
    }
    console.log(`${'='.repeat(60)}`);
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
