import type { AppConfig } from '../../config';
import { Octokit } from '@octokit/rest';
import { createTarDecoder } from 'modern-tar';
import { getOctokit } from './client';
import { getRepoReadme } from './repos';
import { detectAllTestingMetadata, calculateDocsQuality, isCodeFile, isExcludedPath } from './detection';

// ── Code metrics (byte estimation) ─────────────────

export interface CodeMetrics {
  fileCount: number;
  estimatedLoc: number;
}

const BYTES_PER_LINE = 35;

/**
 * Compute file_count and estimated LOC from the Git tree API blob sizes.
 * Pure function — no API calls, no side effects.
 */
export function computeCodeMetrics(
  tree: Array<{ path?: string; type?: string; size?: number }>,
  scopePath?: string,
): CodeMetrics {
  const codeFiles = tree.filter(item => {
    if (item.type !== 'blob') return false;
    const path = item.path || '';
    if (scopePath && !path.startsWith(`${scopePath}/`)) return false;
    return isCodeFile(path) && !isExcludedPath(path);
  });

  return {
    fileCount: codeFiles.length,
    estimatedLoc: codeFiles.reduce(
      (sum, item) => sum + Math.round((item.size ?? 0) / BYTES_PER_LINE),
      0,
    ),
  };
}

// ── Tarball LOC counting ───────────────────────────

export interface TarballLocResult {
  /** Repo-level totals */
  total: { loc: number; fileCount: number };
  /** Per-directory prefix totals (for monorepo apps) */
  byPrefix: Map<string, { loc: number; fileCount: number }>;
}

/**
 * Download repo tarball and count LOC by streaming through gzip + tar.
 * Single API call to GitHub CDN. Streams file-by-file (low memory).
 * @param appPrefixes - Optional list of app path prefixes to track separately
 */
/** Internal timeout for the tarball fetch + streaming (15 seconds). */
const TARBALL_TIMEOUT_MS = 15_000;

export async function countLocFromTarball(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  appPrefixes?: string[],
): Promise<TarballLocResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARBALL_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`,
      {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'github-control', Accept: 'application/vnd.github+json' },
        redirect: 'follow',
        signal: controller.signal,
      },
    );
    if (!res.ok || !res.body) throw new Error(`Tarball fetch failed: ${res.status}`);

    const total = { loc: 0, fileCount: 0 };
    const byPrefix = new Map<string, { loc: number; fileCount: number }>();
    if (appPrefixes) {
      for (const p of appPrefixes) byPrefix.set(p, { loc: 0, fileCount: 0 });
    }

    const tarStream = res.body
      .pipeThrough(new DecompressionStream('gzip'))
      .pipeThrough(createTarDecoder());

    for await (const entry of tarStream) {
      // Check abort between entries
      if (controller.signal.aborted) throw new Error('Tarball processing aborted');

      // Tarball entries are prefixed with "{owner}-{repo}-{sha}/"
      const rawName = entry.header.name;
      const slashIdx = rawName.indexOf('/');
      const path = slashIdx >= 0 ? rawName.slice(slashIdx + 1) : rawName;

      if (!path || entry.header.type !== 'file' || !isCodeFile(path) || isExcludedPath(path)) {
        // Must drain the body to advance the stream
        const reader = entry.body.getReader();
        while (!(await reader.read()).done) { /* drain */ }
        continue;
      }

      // Count newlines by scanning bytes
      let lines = 0;
      const reader = entry.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let i = 0; i < value.length; i++) {
          if (value[i] === 0x0A) lines++;
        }
      }

      total.loc += lines;
      total.fileCount++;

      // Track per-app prefix if requested
      if (appPrefixes) {
        for (const prefix of appPrefixes) {
          if (path.startsWith(`${prefix}/`)) {
            const appEntry = byPrefix.get(prefix)!;
            appEntry.loc += lines;
            appEntry.fileCount++;
            break;
          }
        }
      }
    }

    return { total, byPrefix };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkFileExists(octokit: Octokit, owner: string, repo: string, path: string): Promise<boolean> {
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check health metrics for a repository
 * 
 * Analyzes repo structure to determine presence of:
 * - README (and line count)
 * - CI/CD workflows (.github/workflows/)
 * - Tests (by directory and file patterns)
 * - Gitignore file
 * - Roadmap (docs/roadmap.md)
 * - Documentation files count
 * - Testing metadata (frameworks, config files)
 * 
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Object with health indicators (hasReadme, hasCi, hasTests, etc.)
 */
export async function checkRepoHealth(env: AppConfig, owner: string, repo: string) {
  const octokit = getOctokit(env);

  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const { data: treeData } = await octokit.git.getTree({
    owner, repo, tree_sha: repoData.default_branch, recursive: 'true',
  });
  const paths = treeData.tree.map(item => item.path || '');

  let hasReadme = false;
  let readmeLines = 0;
  const readme = await getRepoReadme(env, owner, repo);
  if (readme) {
    readmeLines = readme.content.split('\n').length;
    hasReadme = readmeLines > 0;
  }

  const hasCi = paths.some(p => p.startsWith('.github/workflows/'));

  const testDirPrefixes = ['test/', 'tests/', 'spec/', '__tests__/', 'src/test/', 'src/tests/'];
  const testFilePatterns = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /_test\.go$/];
  const hasTests = testDirPrefixes.some(prefix => paths.some(p => p.startsWith(prefix))) ||
    paths.some(p => testFilePatterns.some(pat => pat.test(p))) ||
    paths.some(p => p.includes('/__tests__/'));

  const hasGitignore = paths.includes('.gitignore');
  const hasRoadmap = paths.includes('docs/roadmap.md');
  const docsFileCount = paths.filter(p => p.startsWith('docs/') && p.endsWith('.md')).length;

  const testing = detectAllTestingMetadata(paths, repoData.language);

  return { hasReadme, readmeLines, hasCi, hasTests, hasGitignore, hasRoadmap, docsFileCount, ...testing };
}

/**
 * Get the Git tree of code files in a repository
 * 
 * Filters the tree to include only:
 * - Blobs (files, not directories)
 * - Code files (based on extension)
 * - Non-excluded paths (e.g., not in node_modules, dist, etc.)
 * 
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Array of tree items (code files only)
 */
export async function getRepoTree(env: AppConfig, owner: string, repo: string) {
  const octokit = getOctokit(env);
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const { data } = await octokit.git.getTree({
    owner, repo, tree_sha: repoData.default_branch, recursive: 'true',
  });

  return data.tree.filter(item =>
    item.type === 'blob' && isCodeFile(item.path || '') && !isExcludedPath(item.path || '')
  );
}

/**
 * Check health metrics for a specific app within a monorepo
 * 
 * Similar to checkRepoHealth but scoped to a subdirectory (appPath).
 * Useful for monorepos with multiple apps (e.g., apps/api, apps/frontend).
 * 
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param appPath - Path to the app directory (e.g., "apps/api")
 * @param preloadedTree - Optional pre-fetched tree to avoid redundant API calls
 * @returns Object with app-level health indicators
 */
export async function checkAppHealth(env: AppConfig, owner: string, repo: string, appPath: string, preloadedTree?: { path?: string; size?: number; type?: string }[]) {
  const octokit = getOctokit(env);

  let hasReadme = false;
  let readmeLines = 0;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: `${appPath}/README.md` });
    if ('content' in data && data.content) {
      const content = atob(data.content);
      readmeLines = content.split('\n').length;
      hasReadme = readmeLines > 0;
    }
  } catch { /* No README */ }

  let hasTests = false;
  const testPaths = ['test', 'tests', 'spec', '__tests__', 'src/test', 'src/tests'];
  for (const tp of testPaths) {
    if (await checkFileExists(octokit, owner, repo, `${appPath}/${tp}`)) {
      hasTests = true; break;
    }
  }

  let hasCi = false;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: '.github/workflows' });
    if (Array.isArray(data)) {
      for (const file of data) {
        if (!file.name.endsWith('.yml') && !file.name.endsWith('.yaml')) continue;
        try {
          const { data: fileData } = await octokit.repos.getContent({ owner, repo, path: file.path! });
          if ('content' in fileData && fileData.content) {
            const content = atob(fileData.content);
            if (content.includes(appPath)) { hasCi = true; break; }
          }
        } catch { /* Skip unreadable files */ }
      }
    }
  } catch { /* No workflows directory */ }

  let stack: string | null = null;
  if (await checkFileExists(octokit, owner, repo, `${appPath}/package.json`)) stack = 'node';
  else if (await checkFileExists(octokit, owner, repo, `${appPath}/pyproject.toml`) ||
           await checkFileExists(octokit, owner, repo, `${appPath}/setup.py`) ||
           await checkFileExists(octokit, owner, repo, `${appPath}/requirements.txt`)) stack = 'python';
  else if (await checkFileExists(octokit, owner, repo, `${appPath}/go.mod`)) stack = 'go';
  else if (await checkFileExists(octokit, owner, repo, `${appPath}/Cargo.toml`)) stack = 'rust';

  let loc = 0;
  let fileCount = 0;
  let appDocsCount = 0;
  try {
    const tree = preloadedTree || await getRepoTree(env, owner, repo);
    const appFiles = tree.filter(f => f.path?.startsWith(`${appPath}/`));
    fileCount = appFiles.length;
    appDocsCount = tree.filter(f => f.path?.startsWith(`${appPath}/docs/`) && f.path?.endsWith('.md')).length;
    const filesToCount = appFiles.slice(0, 200);
    const lineCounts = await Promise.all(
      filesToCount.map(f => countFileLines(env, owner, repo, f.path!))
    );
    loc = lineCounts.reduce((sum, count) => sum + count, 0);
  } catch { /* Tree fetch failed */ }

  const docsQuality = calculateDocsQuality(hasReadme, readmeLines, appDocsCount);
  return { hasReadme, readmeLines, hasCi, hasTests, stack, loc, fileCount, docsQuality };
}

export async function countFileLines(env: AppConfig, owner: string, repo: string, path: string): Promise<number> {
  const octokit = getOctokit(env);
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if ('content' in data && data.content) {
      const content = atob(data.content);
      return content.split('\n').length;
    }
    return 0;
  } catch {
    return 0;
  }
}
