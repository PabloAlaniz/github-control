import type { AppConfig } from '../../config';
import { getOctokit } from './client';
import { getRepoTree } from './health';

export interface DetectedApp {
  app_path: string;
  app_name: string;
  detection_source: string;
  stack?: string;
}

/**
 * Detect applications/packages within a monorepo
 * 
 * Tries multiple detection strategies:
 * 1. pnpm-workspace.yaml (workspace patterns)
 * 2. package.json workspaces field
 * 3. Fallback to apps/ and packages/ directories with package.json
 * 
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Array of detected apps with path, name, and detection source
 */
export async function detectRepoApps(env: AppConfig, owner: string, repo: string): Promise<DetectedApp[]> {
  const octokit = getOctokit(env);
  const detectedApps: DetectedApp[] = [];

  // Try pnpm-workspace.yaml
  let workspacePatterns: string[] = [];
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: 'pnpm-workspace.yaml' });
    if ('content' in data && data.content) {
      const content = atob(data.content);
      const matches = content.match(/- ["']?([^"'\n]+)["']?/g);
      if (matches) {
        workspacePatterns = matches.map(m => m.replace(/- ["']?/, '').replace(/["']$/, '').trim());
      }
    }
  } catch { /* No pnpm-workspace.yaml */ }

  // Try root package.json workspaces
  if (workspacePatterns.length === 0) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path: 'package.json' });
      if ('content' in data && data.content) {
        const content = atob(data.content);
        const pkg = JSON.parse(content);
        if (Array.isArray(pkg.workspaces)) workspacePatterns = pkg.workspaces;
        else if (pkg.workspaces?.packages) workspacePatterns = pkg.workspaces.packages;
      }
    } catch { /* No package.json */ }
  }

  // Resolve workspace patterns against repo tree
  if (workspacePatterns.length > 0) {
    const tree = await getRepoTree(env, owner, repo);
    const allPaths = tree.map(f => f.path || '');

    for (const pattern of workspacePatterns) {
      const base = pattern.replace(/\/?\*$/, '');
      const dirs = new Set<string>();
      for (const filePath of allPaths) {
        if (filePath.startsWith(`${base}/`)) {
          const rest = filePath.slice(base.length + 1);
          const firstDir = rest.split('/')[0];
          if (firstDir) dirs.add(firstDir);
        }
      }

      for (const dir of dirs) {
        detectedApps.push({
          app_path: `${base}/${dir}`,
          app_name: dir,
          detection_source: 'pnpm_workspace',
        });
      }
    }
  }

  // Also check for standalone root-level apps
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: '' });
    if (Array.isArray(data)) {
      const skipDirs = new Set(['apps', 'packages', '.github', 'docs', 'node_modules', '.git']);
      const detectedPaths = new Set(detectedApps.map(a => a.app_path));

      for (const item of data) {
        if (item.type !== 'dir' || skipDirs.has(item.name)) continue;
        if (detectedPaths.has(item.name)) continue;

        let isApp = false;
        let stack: string | undefined;
        for (const configFile of ['package.json', 'pyproject.toml', 'setup.py', 'go.mod', 'Cargo.toml']) {
          try {
            await octokit.repos.getContent({ owner, repo, path: `${item.name}/${configFile}` });
            isApp = true;
            if (configFile === 'package.json') stack = 'node';
            else if (configFile === 'pyproject.toml' || configFile === 'setup.py') stack = 'python';
            else if (configFile === 'go.mod') stack = 'go';
            else if (configFile === 'Cargo.toml') stack = 'rust';
            break;
          } catch { /* not found */ }
        }

        if (isApp) {
          detectedApps.push({ app_path: item.name, app_name: item.name, detection_source: 'auto', stack });
        }
      }
    }
  } catch { /* Root listing failed */ }

  return detectedApps;
}
