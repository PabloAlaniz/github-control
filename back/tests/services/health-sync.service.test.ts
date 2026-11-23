import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ctxFor } from '../helpers';

// Mock DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(() => Object.assign(vi.fn(), { transaction: vi.fn() })),
}));

// Mock pipeline
const mockRunPipeline = vi.fn();
const mockRunAppPipeline = vi.fn();
vi.mock('@back/lib/analyzers/pipeline', () => ({
  runPipeline: (...args: any[]) => mockRunPipeline(...args),
  runAppPipeline: (...args: any[]) => mockRunAppPipeline(...args),
}));

// Mock enricher
const mockEnrichFromGitHub = vi.fn();
vi.mock('@back/lib/analyzers/github-enricher', () => ({
  enrichFromGitHub: (...args: any[]) => mockEnrichFromGitHub(...args),
}));

// Mock github lib — getOctokit returns an octokit-like object
const mockReposGet = vi.fn().mockResolvedValue({
  data: { default_branch: 'main', language: 'TypeScript', size: 1024 },
});
const mockGetTree = vi.fn().mockResolvedValue({
  data: { tree: [{ path: 'src/index.ts', type: 'blob', size: 3500 }] },
});
const mockCountLocFromTarball = vi.fn();
vi.mock('@back/lib/github', async () => {
  const actual = await vi.importActual<any>('@back/lib/github/health');
  return {
    getOctokit: vi.fn().mockReturnValue({
      repos: { get: (...a: any[]) => mockReposGet(...a), getReadme: vi.fn() },
      git: { getTree: (...a: any[]) => mockGetTree(...a) },
    }),
    getRepoReadme: vi.fn().mockResolvedValue(null),
    computeCodeMetrics: actual.computeCodeMetrics,
    countLocFromTarball: (...a: any[]) => mockCountLocFromTarball(...a),
  };
});

import { syncRepoHealth, syncAppHealth, NotFoundError } from '@back/services/health-sync.service';

const env: any = { DATABASE_URL: 'test', GITHUB_TOKEN: 'ghp_test' };

describe('health-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('syncRepoHealth', () => {
    it('throws NotFoundError when repo not in DB', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(syncRepoHealth(ctxFor(env), 'owner', 'repo')).rejects.toThrow(NotFoundError);
    });

    it('returns codeMetrics from tarball when successful', async () => {
      mockQueryOne.mockResolvedValueOnce({ language: 'TypeScript' });
      mockRunPipeline.mockResolvedValueOnce({
        hasReadme: true, readmeLines: 50, hasCi: true, hasTests: true,
        docsQuality: 'good', stack: 'node', isMonorepo: false, apps: [],
      });
      mockEnrichFromGitHub.mockResolvedValueOnce({
        repo_size_kb: 1000, topics: [], license_key: null, is_fork: false,
        default_branch: 'main', homepage: null, license_name: null,
        has_issues: true, has_projects: true, has_wiki: true, has_pages: false,
        has_discussions: false, subscribers_count: 1, is_template: false,
        parent_repo: null,
      });
      mockCountLocFromTarball.mockResolvedValueOnce({
        total: { loc: 500, fileCount: 10 },
        byPrefix: new Map(),
      });
      mockQuery.mockResolvedValue([]);

      const result = await syncRepoHealth(ctxFor(env), 'owner', 'repo');

      expect(result.codeMetrics).toEqual({ loc: 500, fileCount: 10, source: 'tarball' });
    });

    it('falls back to byte estimation when tarball fails', async () => {
      mockQueryOne.mockResolvedValueOnce({ language: 'TypeScript' });
      mockGetTree.mockResolvedValueOnce({
        data: { tree: [
          { path: 'src/index.ts', type: 'blob', size: 3500 },
          { path: 'src/utils.ts', type: 'blob', size: 1750 },
        ] },
      });
      mockRunPipeline.mockResolvedValueOnce({
        hasReadme: false, readmeLines: 0, hasCi: false, hasTests: false,
        docsQuality: 'missing', stack: 'node', isMonorepo: false, apps: [],
      });
      mockEnrichFromGitHub.mockResolvedValueOnce({
        repo_size_kb: 500, topics: [], license_key: null, is_fork: false,
        default_branch: 'main', homepage: null, license_name: null,
        has_issues: true, has_projects: false, has_wiki: false, has_pages: false,
        has_discussions: false, subscribers_count: 0, is_template: false,
        parent_repo: null,
      });
      mockCountLocFromTarball.mockRejectedValueOnce(new Error('Tarball fetch failed: 403'));
      mockQuery.mockResolvedValue([]);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await syncRepoHealth(ctxFor(env), 'owner', 'repo');
      consoleSpy.mockRestore();

      expect(result.codeMetrics.source).toBe('estimate');
      expect(result.codeMetrics.fileCount).toBe(2);
      expect(result.codeMetrics.loc).toBe(Math.round(3500 / 35) + Math.round(1750 / 35));
    });

    it('handles monorepo app sync errors gracefully', async () => {
      // getLanguage
      mockQueryOne.mockResolvedValueOnce({ language: 'TypeScript' });

      // Pipeline returns monorepo with apps
      mockRunPipeline.mockResolvedValueOnce({
        hasReadme: true, readmeLines: 50, hasCi: true, hasTests: true,
        docsQuality: 'good', stack: 'node', isMonorepo: true,
        apps: [{ appPath: 'apps/web', appName: 'web', detectionSource: 'pnpm', stack: 'node' }],
      });

      // enrichFromGitHub
      mockEnrichFromGitHub.mockResolvedValueOnce({
        repo_size_kb: 1000, topics: [], license_key: null, is_fork: false,
        default_branch: 'main', homepage: null, license_name: null,
        has_issues: true, has_projects: true, has_wiki: true, has_pages: false,
        has_discussions: false, subscribers_count: 1, is_template: false,
        parent_repo: null,
      });

      // Tarball succeeds with app prefix
      mockCountLocFromTarball.mockResolvedValueOnce({
        total: { loc: 1000, fileCount: 20 },
        byPrefix: new Map([['apps/web', { loc: 500, fileCount: 10 }]]),
      });

      // updateRepoHealth
      mockQuery.mockResolvedValueOnce([]);
      // logActivity
      mockQuery.mockResolvedValueOnce([]);

      // upsertApp fails
      mockQueryOne.mockRejectedValueOnce(new Error('DB constraint'));
      // deleteStaleApps
      mockQuery.mockResolvedValueOnce([]);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await syncRepoHealth(ctxFor(env), 'owner', 'repo');

      expect(result.apps.detected).toBe(1);
      expect(result.apps.synced).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('App sync failed'),
        expect.any(String),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('syncAppHealth', () => {
    it('uses preloaded tree when provided', async () => {
      const preloadedTree = [
        { path: 'apps/web/index.ts' },
        { path: 'apps/web/README.md' },
      ];

      mockRunAppPipeline.mockResolvedValueOnce({
        hasCi: true, hasTests: true, hasReadme: true, readmeLines: 50,
        stack: 'node', docsQuality: 'good',
        hasUnitTests: true, hasIntegrationTests: false, hasE2eTests: false,
        hasLintConfig: true, hasTypeChecking: true, hasSecurityScan: false, hasPerfTests: false,
        testFramework: 'vitest', e2eFramework: null, lintTool: 'eslint',
      });

      // updateAppHealth
      mockQuery.mockResolvedValueOnce([]);

      const result = await syncAppHealth(ctxFor(env), 'owner', 'repo', 'apps/web', 'o-r-web', preloadedTree);

      expect(result.hasCi).toBe(true);
      expect(result.hasReadme).toBe(true);
      // Should NOT call octokit.repos.get since tree was preloaded
      expect(mockReposGet).not.toHaveBeenCalled();
    });

    it('fetches fresh tree when no preloaded tree', async () => {
      mockRunAppPipeline.mockResolvedValueOnce({
        hasCi: false, hasTests: false, hasReadme: false, readmeLines: 0,
        stack: null, docsQuality: 'missing',
      });
      mockQuery.mockResolvedValueOnce([]);

      const result = await syncAppHealth(ctxFor(env), 'owner', 'repo', 'apps/api', 'o-r-api');

      expect(result.hasReadme).toBe(false);
      expect(result.docsQuality).toBe('missing');
    });
  });

  describe('NotFoundError', () => {
    it('has correct name', () => {
      const err = new NotFoundError('test');
      expect(err.name).toBe('NotFoundError');
      expect(err.message).toBe('test');
    });
  });
});
