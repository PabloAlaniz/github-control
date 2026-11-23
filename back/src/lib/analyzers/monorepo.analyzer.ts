import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnalyzerInput, Analyzer, MonorepoApp } from './types';

interface MonorepoResult {
  isMonorepo: boolean;
  apps: MonorepoApp[];
}

// ---------------------------------------------------------------------------
// Dirs to skip when auto-detecting standalone root-level apps
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'apps',
  'packages',
  '.github',
  'docs',
  'node_modules',
  '.git',
  'scripts',
  'config',
]);

// ---------------------------------------------------------------------------
// Stack detection from config file name
// ---------------------------------------------------------------------------

const CONFIG_FILES: Array<{ file: string; stack: string }> = [
  { file: 'package.json', stack: 'node' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'setup.py', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
];

// ---------------------------------------------------------------------------
// Workspace pattern readers (filesystem-based)
// ---------------------------------------------------------------------------

/**
 * Parse pnpm-workspace.yaml using simple regex (no yaml lib needed).
 * Matches lines like:  - "apps/*"  or  - packages/*
 */
function parsePnpmWorkspacePatterns(content: string): string[] {
  const matches = content.match(/- ["']?([^"'\n]+)["']?/g);
  if (!matches) return [];
  return matches.map(m => m.replace(/- ["']?/, '').replace(/["']$/, '').trim());
}

/**
 * Read workspace patterns from pnpm-workspace.yaml on disk.
 */
function readPnpmWorkspacePatterns(cloneDir: string): string[] {
  const filePath = join(cloneDir, 'pnpm-workspace.yaml');
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parsePnpmWorkspacePatterns(content);
  } catch {
    return [];
  }
}

/**
 * Read workspace patterns from root package.json (supports array and { packages } forms).
 */
function readPackageJsonWorkspaces(cloneDir: string): string[] {
  const filePath = join(cloneDir, 'package.json');
  if (!existsSync(filePath)) return [];

  try {
    const pkg = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
    if (pkg.workspaces?.packages) return pkg.workspaces.packages;
  } catch {
    // invalid JSON
  }

  return [];
}

// ---------------------------------------------------------------------------
// Pattern resolution — list subdirectories under each workspace base dir
// ---------------------------------------------------------------------------

function resolveWorkspacePatterns(
  cloneDir: string,
  patterns: string[],
  detectionSource: string,
): MonorepoApp[] {
  const apps: MonorepoApp[] = [];

  for (const pattern of patterns) {
    // Strip trailing glob: "apps/*" → "apps", "packages/**" → "packages"
    const base = pattern.replace(/\/?\*+$/, '');
    const baseDir = join(cloneDir, base);
    if (!existsSync(baseDir)) continue;

    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const appPath = `${base}/${entry.name}`;
        const stack = detectStackForDir(join(cloneDir, appPath));

        apps.push({
          appPath,
          appName: entry.name,
          detectionSource,
          ...(stack ? { stack } : {}),
        });
      }
    } catch {
      // can't read dir — skip
    }
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Auto-detect standalone root-level app dirs (dirs with config files)
// ---------------------------------------------------------------------------

function detectStackForDir(dir: string): string | undefined {
  for (const { file, stack } of CONFIG_FILES) {
    if (existsSync(join(dir, file))) return stack;
  }
  return undefined;
}

function detectStandaloneApps(
  cloneDir: string,
  alreadyDetectedPaths: Set<string>,
): MonorepoApp[] {
  const apps: MonorepoApp[] = [];

  try {
    const entries = readdirSync(cloneDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      if (alreadyDetectedPaths.has(entry.name)) continue;

      const stack = detectStackForDir(join(cloneDir, entry.name));
      if (stack) {
        apps.push({
          appPath: entry.name,
          appName: entry.name,
          detectionSource: 'auto',
          stack,
        });
      }
    }
  } catch {
    // root listing failed
  }

  return apps;
}

// ---------------------------------------------------------------------------
// Filesystem-based detection (when cloneDir is available)
// ---------------------------------------------------------------------------

function detectFromDisk(cloneDir: string): MonorepoResult {
  // 1. Try pnpm-workspace.yaml
  let patterns = readPnpmWorkspacePatterns(cloneDir);
  let detectionSource = 'pnpm_workspace';

  // 2. Fallback to package.json workspaces
  if (patterns.length === 0) {
    patterns = readPackageJsonWorkspaces(cloneDir);
    detectionSource = 'package_json_workspaces';
  }

  // 3. Resolve workspace patterns into app entries
  const apps = resolveWorkspacePatterns(cloneDir, patterns, detectionSource);

  // 4. Auto-detect standalone root-level apps not caught by workspace patterns
  const alreadyDetected = new Set(apps.map(a => a.appPath));
  const standaloneApps = detectStandaloneApps(cloneDir, alreadyDetected);
  apps.push(...standaloneApps);

  return {
    isMonorepo: apps.length > 1 || patterns.length > 0,
    apps,
  };
}

// ---------------------------------------------------------------------------
// Path-only detection (API mode — no filesystem access)
// ---------------------------------------------------------------------------

function detectFromPaths(paths: string[]): MonorepoResult {
  const apps: MonorepoApp[] = [];

  // Check for workspace config files in the path list
  const hasPnpmWorkspace = paths.includes('pnpm-workspace.yaml');
  const hasLernaConfig = paths.includes('lerna.json');

  // Check for root package.json (potential workspaces field — can't read content)
  const hasRootPkg = paths.includes('package.json');

  // Detect obvious monorepo signals: multiple package.json files at depth 1-2
  // e.g. "apps/web/package.json", "packages/ui/package.json", "front/package.json"
  const nestedPkgJsons = paths.filter(p => {
    if (p === 'package.json') return false; // skip root
    const parts = p.split('/');
    return (
      parts[parts.length - 1] === 'package.json' && parts.length >= 2 && parts.length <= 3
    );
  });

  // Similarly detect other config files at depth 1-2
  const nestedConfigs = paths.filter(p => {
    const parts = p.split('/');
    if (parts.length < 2 || parts.length > 3) return false;
    const fileName = parts[parts.length - 1];
    return CONFIG_FILES.some(cf => cf.file === fileName);
  });

  // Build app entries from nested config files
  const seenPaths = new Set<string>();
  for (const configPath of [...nestedPkgJsons, ...nestedConfigs]) {
    const parts = configPath.split('/');
    const fileName = parts[parts.length - 1];
    // appPath is everything except the config filename
    const appPath = parts.slice(0, -1).join('/');
    if (seenPaths.has(appPath)) continue;
    seenPaths.add(appPath);

    const appName = parts.length === 2 ? parts[0] : parts[1];
    const configFile = CONFIG_FILES.find(cf => cf.file === fileName);

    apps.push({
      appPath,
      appName,
      detectionSource: 'path_analysis',
      ...(configFile ? { stack: configFile.stack } : {}),
    });
  }

  const isMonorepo =
    hasPnpmWorkspace ||
    hasLernaConfig ||
    nestedPkgJsons.length >= 2 ||
    apps.length > 1;

  return { isMonorepo, apps };
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

export const analyzeMonorepo: Analyzer<MonorepoResult> = (
  input: AnalyzerInput,
): MonorepoResult => {
  // When cloneDir is available, use filesystem-based detection for full accuracy
  if (input.cloneDir) {
    return detectFromDisk(input.cloneDir);
  }

  // Otherwise, fall back to path-only heuristics
  return detectFromPaths(input.paths);
};
