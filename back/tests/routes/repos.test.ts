import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTransaction = vi.fn();
const mockDbFn = Object.assign(vi.fn(), { transaction: mockTransaction, query: vi.fn() });
const mockGetDb = vi.fn(() => mockDbFn);
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: (...args: any[]) => mockGetDb(...args),
}));

// Mock GitHub lib
const mockGetReposWithMetrics = vi.fn();
const mockCheckRepoHealth = vi.fn();
const mockGetRepoDetails = vi.fn();
const mockGetRepoReadme = vi.fn().mockResolvedValue(null);
const mockArchiveRepo = vi.fn().mockResolvedValue(undefined);
const mockDetectRepoApps = vi.fn().mockResolvedValue([]);
const mockGetRepoTree = vi.fn().mockResolvedValue([]);
const mockCheckAppHealth = vi.fn().mockResolvedValue({});
const mockGetOctokit = vi.fn().mockReturnValue({
  repos: {
    get: vi.fn().mockResolvedValue({
      data: { default_branch: 'main', language: 'TypeScript', stargazers_count: 0, forks_count: 0, watchers_count: 0, subscribers_count: 0, open_issues_count: 0, topics: [], fork: false, private: false, archived: false, size: 100, is_template: false, has_issues: true, has_projects: true, has_wiki: true, has_pages: false, has_discussions: false, pushed_at: null, created_at: null, updated_at: null, license: null, homepage: null, parent: null, description: null },
    }),
  },
  git: {
    getTree: vi.fn().mockResolvedValue({ data: { tree: [] } }),
  },
});
vi.mock('@back/lib/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@back/lib/github')>();
  return {
    getReposWithMetrics: (...args: any[]) => mockGetReposWithMetrics(...args),
    getRepoDetails: (...args: any[]) => mockGetRepoDetails(...args),
    getRepoReadme: (...args: any[]) => mockGetRepoReadme(...args),
    archiveRepo: (...args: any[]) => mockArchiveRepo(...args),
    checkRepoHealth: (...args: any[]) => mockCheckRepoHealth(...args),
    calculateDocsQuality: actual.calculateDocsQuality,
    computeCodeMetrics: actual.computeCodeMetrics,
    countLocFromTarball: vi.fn().mockRejectedValue(new Error('no tarball in test')),
    detectRepoApps: (...args: any[]) => mockDetectRepoApps(...args),
    getRepoTree: (...args: any[]) => mockGetRepoTree(...args),
    checkAppHealth: (...args: any[]) => mockCheckAppHealth(...args),
    getOctokit: (...args: any[]) => mockGetOctokit(...args),
  };
});

// Mock analyzers pipeline (used by health-sync.service)
const mockRunPipeline = vi.fn();
const mockRunAppPipeline = vi.fn();
vi.mock('@back/lib/analyzers/pipeline', () => ({
  runPipeline: (...args: any[]) => mockRunPipeline(...args),
  runAppPipeline: (...args: any[]) => mockRunAppPipeline(...args),
}));

// Mock GitHub enricher
const mockEnrichFromGitHub = vi.fn();
vi.mock('@back/lib/analyzers/github-enricher', () => ({
  enrichFromGitHub: (...args: any[]) => mockEnrichFromGitHub(...args),
}));

// Mock Anthropic SDK so generate-summary doesn't need a real API key.
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function () { return {
    messages: { create: (...args: any[]) => mockAnthropicCreate(...args) },
  }; }),
}));

// Import the app AFTER mocks are set up
import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  }
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('repos routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Core route tests ──────────────────────────────────────

  describe('GET /api/repos', () => {
    it('returns repo list enriched with coverage_reports and health_score', async () => {
      const fakeRepos = [
        { id: 1, full_name: 'owner/repo1', groups: ['web'] },
        { id: 2, full_name: 'owner/repo2', groups: [] },
      ];
      const fakeCoverage = [
        { repo_full_name: 'owner/repo1', label: 'frontend', coverage: 58 },
        { repo_full_name: 'owner/repo1', label: 'backend', coverage: 41 },
      ];
      mockQuery
        .mockResolvedValueOnce(fakeRepos)
        .mockResolvedValueOnce(fakeCoverage)
        .mockResolvedValueOnce([])   // apps
        .mockResolvedValueOnce([])   // trends
        .mockResolvedValueOnce([]);  // signals

      const res = await request('/api/repos');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0]).toMatchObject({
        id: 1,
        full_name: 'owner/repo1',
        groups: ['web'],
        coverage_reports: [
          { label: 'frontend', coverage: 58 },
          { label: 'backend', coverage: 41 },
        ],
        apps: [],
        is_monorepo: false,
        health_score: { score: expect.any(Number), grade: expect.any(String), archived: false },
      });
      expect(body[1]).toMatchObject({
        id: 2,
        full_name: 'owner/repo2',
        coverage_reports: [],
        health_score: { score: 0, grade: 'F', archived: false },
      });
    });
  });

  describe('GET /api/repos/:owner/:repo/health-score', () => {
    it('returns full breakdown for a known repo', async () => {
      const fakeRepo = {
        id: 1,
        full_name: 'owner/repo',
        has_ci: true,
        has_tests: true,
        has_unit_tests: true,
        has_integration_tests: false,
        has_e2e_tests: false,
        test_coverage: 70,
        has_readme: true,
        readme_lines: 60,
        has_roadmap: false,
        docs_quality: 'good',
        has_lint_config: true,
        has_type_checking: true,
        has_security_scan: false,
        has_gitignore: true,
        has_docstrings: false,
        last_commit_at: new Date().toISOString(),
        is_archived: false,
      };
      mockQueryOne.mockResolvedValue(fakeRepo);
      mockQuery.mockResolvedValue([]);  // signals

      const res = await request('/api/repos/owner/repo/health-score');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repo).toBe('owner/repo');
      expect(body.score).toBeGreaterThan(0);
      expect(body.score).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(body.grade);
      expect(body.breakdown).toHaveProperty('ci');
      expect(body.breakdown).toHaveProperty('tests');
      expect(body.breakdown).toHaveProperty('docs');
      expect(body.breakdown).toHaveProperty('quality');
      expect(body.breakdown).toHaveProperty('hygiene');
      expect(body.breakdown).toHaveProperty('freshness');
      expect(body.computed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('returns 404 for unknown repo', async () => {
      mockQueryOne.mockResolvedValue(null);
      const res = await request('/api/repos/owner/missing/health-score');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/repos/:owner/:repo', () => {
    it('returns 404 for unknown repo', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/repos/owner/unknown');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('Repo not found');
    });

    it('returns repo when found', async () => {
      const fakeRepo = { id: 1, full_name: 'owner/repo', groups: ['api'] };
      mockQueryOne.mockResolvedValue(fakeRepo);

      const res = await request('/api/repos/owner/repo');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(fakeRepo);
    });
  });

  describe('POST /api/repos/refresh', () => {
    it('returns sync summary on success', async () => {
      mockGetReposWithMetrics.mockResolvedValue([
        {
          full_name: 'owner/repo1', owner: 'owner', name: 'repo1',
          description: null, is_private: false, is_archived: false,
          language: 'TypeScript', default_branch: 'main',
          stars: 10, forks: 2, watchers: 5, open_issues: 1,
          last_commit_at: null, repo_created_at: null, repo_updated_at: null,
        },
      ]);
      mockTransaction.mockResolvedValue([[], [], []]);

      const res = await request('/api/repos/refresh', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(1);
      expect(body.total).toBe(1);
      expect(body.removed).toBe(0);
      expect(body.timestamp).toBeDefined();
    });

    // ── Regression: Bug 2 — POST /api/repos/refresh crashed with 500 ──

    it('returns structured error when GITHUB_TOKEN is missing', async () => {
      const envNoToken = { ...mockEnv, GITHUB_TOKEN: '' };

      const res = await app.request('/api/repos/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mockEnv.API_KEY}` },
      }, envNoToken);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('GITHUB_TOKEN');
    });

    it('returns structured error when GitHub API fails', async () => {
      mockGetReposWithMetrics.mockRejectedValue(new Error('API rate limit exceeded'));

      const res = await request('/api/repos/refresh', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('API rate limit exceeded');
    });

    it('returns 500 when DB transaction fails', async () => {
      mockGetReposWithMetrics.mockResolvedValue([
        { full_name: 'owner/repo1', owner: 'owner', name: 'repo1', description: null, is_private: false, is_archived: false, language: null, default_branch: 'main', stars: 0, forks: 0, watchers: 0, open_issues: 0, last_commit_at: null, repo_created_at: null, repo_updated_at: null },
      ]);
      mockTransaction.mockRejectedValue(new Error('DB connection failed'));

      const res = await request('/api/repos/refresh', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('DB connection failed');
    });

    it('reports removed repos when GitHub no longer returns them', async () => {
      mockGetReposWithMetrics.mockResolvedValue([
        { full_name: 'owner/repo1', owner: 'owner', name: 'repo1', description: null, is_private: false, is_archived: false, language: null, default_branch: 'main', stars: 0, forks: 0, watchers: 0, open_issues: 0, last_commit_at: null, repo_created_at: null, repo_updated_at: null },
      ]);
      mockTransaction.mockResolvedValue([[], [{ full_name: 'owner/old-repo' }], []]);

      const res = await request('/api/repos/refresh', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(1);
      expect(body.removed).toBe(1);
      expect(body.removedRepos).toEqual(['owner/old-repo']);
    });

    it('does not modify DB when GitHub returns zero repos (safety guard)', async () => {
      mockGetReposWithMetrics.mockResolvedValue([]);

      const res = await request('/api/repos/refresh', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(0);
      expect(body.total).toBe(0);
      expect(body.removed).toBe(0);
      expect(mockGetDb).not.toHaveBeenCalled();
    });
  });

  // ── Regression: Bug 1 — POST /api/repos/:owner/:repo/health/sync returned 404 ──

  describe('POST /api/repos/:owner/:repo/health/sync', () => {
    const mockGitHubMetadata = {
      description: null, language: 'TypeScript', default_branch: 'main',
      stars: 0, forks: 0, watchers: 0, subscribers_count: 1, open_issues: 0,
      topics: [], license_key: null, license_name: null, homepage: null,
      is_fork: false, parent_repo: null, is_template: false, is_private: false,
      is_archived: false, has_issues: true, has_projects: true, has_wiki: true,
      has_pages: false, has_discussions: false, repo_size_kb: 1024,
      last_commit_at: null, repo_created_at: null, repo_updated_at: null,
    };

    function mockPipelineResult(overrides: Record<string, any> = {}) {
      return {
        stack: 'node', hasReadme: false, readmeLines: 0, docsQuality: 'missing',
        docsFileCount: 0, hasCi: false, hasTests: false, hasGitignore: false,
        hasRoadmap: false, hasUnitTests: false, hasIntegrationTests: false,
        hasE2eTests: false, testFramework: null, e2eFramework: null,
        hasLintConfig: false, lintTool: null, hasTypeChecking: false,
        hasSecurityScan: false, hasPerfTests: false, coverageConfigDetected: false,
        coverageToolDetected: null, estimatedCoverage: null, isMonorepo: false, apps: [],
        ...overrides,
      };
    }

    beforeEach(() => {
      mockEnrichFromGitHub.mockResolvedValue(mockGitHubMetadata);
    });

    it('returns 200 with health data including docsQuality', async () => {
      mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
      mockRunPipeline.mockResolvedValue(mockPipelineResult({
        hasReadme: true, readmeLines: 42, hasCi: true, hasTests: true,
        hasGitignore: true, hasRoadmap: true, docsQuality: 'needs_work', stack: 'node',
      }));
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.health).toMatchObject({
        hasReadme: true, readmeLines: 42, hasCi: true, hasTests: true,
        hasGitignore: true, hasRoadmap: true, stack: 'node', docsQuality: 'needs_work',
      });
    });

    it('returns handler-404 (not router-404) when repo not in DB', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/repos/owner/missing/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain('not found');
    });

    it('maps language to stack correctly', async () => {
      const cases = [
        { language: 'TypeScript', expectedStack: 'node' },
        { language: 'Python', expectedStack: 'python' },
        { language: null, expectedStack: 'unknown' },
      ];

      for (const { language, expectedStack } of cases) {
        vi.clearAllMocks();
        mockQueryOne.mockResolvedValue({ language });
        mockRunPipeline.mockResolvedValue(mockPipelineResult({ stack: expectedStack }));
        mockEnrichFromGitHub.mockResolvedValue(mockGitHubMetadata);
        mockQuery.mockResolvedValue([]);

        const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
        const body = await res.json();

        expect(body.health.stack).toBe(expectedStack);
      }
    });

    it('sets docsQuality to excellent when docs has >= 2 md files', async () => {
      mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
      mockRunPipeline.mockResolvedValue(mockPipelineResult({
        hasReadme: true, readmeLines: 30, hasCi: true, hasTests: true,
        hasGitignore: true, hasRoadmap: true, docsFileCount: 3, docsQuality: 'excellent', stack: 'node',
      }));
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(body.health.docsQuality).toBe('excellent');
    });

    it('sets docsQuality to missing when no README', async () => {
      mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
      mockRunPipeline.mockResolvedValue(mockPipelineResult({
        docsQuality: 'missing',
      }));
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(body.health.docsQuality).toBe('missing');
    });

    it('returns 500 with message when pipeline throws', async () => {
      mockQueryOne.mockResolvedValue({ language: 'TypeScript' });
      mockRunPipeline.mockRejectedValue(new Error('GitHub API is down'));

      const res = await request('/api/repos/owner/repo/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('GitHub API is down');
    });
  });

  // ── Coverage reports ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/coverage', () => {
    it('upserts coverage with label and updates repos table', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverage: 58, label: 'frontend', commit_sha: 'abc123' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.label).toBe('frontend');
      // Should make two queries: one for coverage_reports upsert, one for repos update
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][1]).toContain('INSERT INTO coverage_reports');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo', 'frontend', 58, 'abc123']);
    });

    it('defaults label to "default" when not provided', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverage: 75 }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.label).toBe('default');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo', 'default', 75, undefined]);
    });
  });

  describe('GET /api/repos/:owner/:repo/coverage', () => {
    it('returns coverage reports for a repo', async () => {
      const fakeReports = [
        { label: 'backend', coverage: 41, commit_sha: 'abc', reported_at: '2025-01-01' },
        { label: 'frontend', coverage: 58, commit_sha: 'def', reported_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValue(fakeReports);

      const res = await request('/api/repos/owner/repo/coverage');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(fakeReports);
      expect(mockQuery.mock.calls[0][1]).toContain('SELECT label, coverage');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo']);
    });
  });

  // ── Deleted repos ──────────────────────────────────────

  describe('GET /api/repos/deleted', () => {
    it('returns deleted repos', async () => {
      const fakeDeleted = [
        { full_name: 'owner/old', deletion_detected_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValue(fakeDeleted);

      const res = await request('/api/repos/deleted');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(fakeDeleted);
    });

    it('returns empty array when no deleted repos', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/deleted');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([]);
    });
  });

  describe('DELETE /api/repos/deleted/purge', () => {
    it('purges specific repo by full_name', async () => {
      mockQuery.mockResolvedValue([{ full_name: 'owner/old' }]);

      const res = await request('/api/repos/deleted/purge?full_name=owner/old', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.purged).toBe(1);
      expect(body.purgedRepos).toEqual(['owner/old']);
    });

    it('purges all deleted repos when no full_name', async () => {
      mockQuery.mockResolvedValue([{ full_name: 'a/b' }, { full_name: 'c/d' }]);

      const res = await request('/api/repos/deleted/purge', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.purged).toBe(2);
    });

    it('returns purged=0 when nothing to purge', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/deleted/purge', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.purged).toBe(0);
      expect(body.purgedRepos).toBeUndefined();
    });
  });

  // ── Filter ──────────────────────────────────────

  describe('GET /api/repos/filter', () => {
    it('filters by stack', async () => {
      mockQuery.mockResolvedValue([{ full_name: 'owner/repo', stack: 'node' }]);

      const res = await request('/api/repos/filter?stack=node');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
    });

    it('filters with multiple params', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/filter?stack=node&has_ci=true&priority=high');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns all active repos with no filters', async () => {
      mockQuery.mockResolvedValue([{ full_name: 'a/b' }, { full_name: 'c/d' }]);

      const res = await request('/api/repos/filter');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
    });

    it('filters deleted repos when deleted=true', async () => {
      mockQuery.mockResolvedValue([{ full_name: 'owner/del', is_deleted: true }]);

      const res = await request('/api/repos/filter?deleted=true');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
    });
  });

  // ── Archive ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/archive', () => {
    it('archives repo on GitHub and updates DB', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/archive', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockArchiveRepo).toHaveBeenCalledWith(expect.anything(), 'owner', 'repo');
    });
  });

  // ── Status ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/status', () => {
    it('updates local_status', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Delete repo ──────────────────────────────────────

  describe('DELETE /api/repos/:owner/:repo', () => {
    it('deletes repo from DB', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── README ──────────────────────────────────────

  describe('GET /api/repos/:owner/:repo/readme', () => {
    it('returns cached README from DB', async () => {
      mockQueryOne.mockResolvedValue({ readme_content: '# Hello' });

      const res = await request('/api/repos/owner/repo/readme');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe('# Hello');
      expect(body.source).toBe('cache');
    });

    it('fetches from GitHub when not cached', async () => {
      mockQueryOne.mockResolvedValue({ readme_content: null });
      mockGetRepoReadme.mockResolvedValue({ content: '# From GH', sha: 'abc' });
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/readme');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.content).toBe('# From GH');
      expect(body.source).toBe('github');
    });

    it('returns 404 when no README anywhere', async () => {
      mockQueryOne.mockResolvedValue({ readme_content: null });
      mockGetRepoReadme.mockResolvedValue(null);

      const res = await request('/api/repos/owner/repo/readme');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain('README not found');
    });
  });

  // ── Docs ──────────────────────────────────────

  describe('GET /api/repos/:owner/:repo/docs', () => {
    it('returns readme and summary', async () => {
      mockQueryOne.mockResolvedValue({ readme_content: '# Docs', summary: { title: 'Test' } });

      const res = await request('/api/repos/owner/repo/docs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.readme).toBe('# Docs');
      expect(body.summary).toEqual({ title: 'Test' });
    });

    it('returns nulls when no docs', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/repos/owner/repo/docs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.readme).toBeNull();
      expect(body.summary).toBeNull();
    });
  });

  // ── Summary ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/summary', () => {
    it('saves summary to DB', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'My Repo', description: 'desc' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Health manual update ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/health', () => {
    it('updates health fields in DB', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          has_ci: true, has_tests: true, has_readme: true, has_gitignore: true,
          test_coverage: 80, readme_lines: 50, stack: 'node', has_roadmap: true,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Priority ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/priority', () => {
    it('updates priority', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/priority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'high' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Blockers ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/blockers', () => {
    it('appends blocker', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/blockers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocker: 'waiting on API' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('DELETE /api/repos/:owner/:repo/blockers', () => {
    it('removes blocker', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/owner/repo/blockers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocker: 'waiting on API' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  // ── Generate summary ──────────────────────────────────────

  describe('POST /api/repos/:owner/:repo/generate-summary', () => {
    const envWithKey = { ...mockEnv, ANTHROPIC_API_KEY: 'sk-test' };
    const reqWithKey = (path: string, options?: RequestInit) => {
      const headers = new Headers(options?.headers);
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${envWithKey.API_KEY}`);
      return app.request(path, { ...options, headers }, envWithKey);
    };

    it('generates summary from README via Claude SDK', async () => {
      // No cached summary, then README returns content.
      mockQueryOne.mockResolvedValueOnce(null);
      mockQueryOne.mockResolvedValueOnce({
        readme_content: '# My Project\n\nThis is a great project that does many things.',
      });
      mockQuery.mockResolvedValueOnce(undefined);  // persistSummary UPDATE

      mockAnthropicCreate.mockResolvedValueOnce({
        model: 'claude-opus-4-7',
        content: [{ type: 'text', text: JSON.stringify({
          title: 'My Project',
          description: 'A great project.',
          keyFeatures: ['Fast', 'Simple'],
          primaryUseCase: 'Demo',
          audience: 'Devs',
        }) }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 },
      });

      const res = await reqWithKey('/api/repos/owner/repo/generate-summary', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.summary.title).toBe('My Project');
      expect(body.summary.source).toBe('ai');
      expect(body.summary.model).toBe('claude-opus-4-7');
    });

    it('returns 400 when no README is cached', async () => {
      mockQueryOne.mockResolvedValueOnce(null);   // no cached summary
      mockQueryOne.mockResolvedValueOnce({ readme_content: null });

      const res = await reqWithKey('/api/repos/owner/repo/generate-summary', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('No README');
    });

    it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
      const res = await request('/api/repos/owner/repo/generate-summary', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('ANTHROPIC_API_KEY');
    });
  });

  // ── API key auth tests ──────────────────────────────────────

  describe('API key authentication', () => {
    it('returns 401 when no Authorization header is sent', async () => {
      const res = await app.request('/api/repos', {
        headers: {},
      }, mockEnv);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBeDefined();
    });

    it('returns 401 when an invalid key is sent', async () => {
      const res = await app.request('/api/repos', {
        headers: { Authorization: 'Bearer wrong-key' },
      }, mockEnv);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBeDefined();
    });

    it('allows /api/health without auth', async () => {
      const res = await app.request('/api/health', {}, mockEnv);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
    });

    it('allows /api/health/ready without auth', async () => {
      const res = await app.request('/api/health/ready', {}, mockEnv);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
      expect(body.checks).toMatchObject({
        DATABASE_URL: 'ok',
        GITHUB_TOKEN: 'ok',
        API_KEY: 'ok',
      });
    });

    it('returns 503 when critical env vars are missing', async () => {
      const envNoDb = { ...mockEnv, DATABASE_URL: '' };
      const res = await app.request('/api/health/ready', {}, envNoDb);
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.status).toBe('degraded');
      expect(body.checks.DATABASE_URL).toBe('missing');
      expect(body.missing).toContain('DATABASE_URL');
    });
  });

  // ── Validate endpoint (agent gating) ──────────────────────

  describe('GET /api/repos/:owner/:repo/validate', () => {
    it('returns allowed=true for high priority repo', async () => {
      mockQueryOne.mockResolvedValue({ priority: 'high', is_archived: false, is_deleted: false });

      const res = await request('/api/repos/acme/tracker/validate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repo).toBe('acme/tracker');
      expect(body.found).toBe(true);
      expect(body.allowed).toBe(true);
      expect(body.priority).toBe('high');
      expect(body.reason).toBeNull();
    });

    it('returns allowed=false for medium priority repo', async () => {
      mockQueryOne.mockResolvedValue({ priority: 'medium', is_archived: false, is_deleted: false });

      const res = await request('/api/repos/owner/medium-repo/validate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.allowed).toBe(false);
      expect(body.reason).toContain("'medium'");
    });

    it('returns allowed=false for archived repo even if high priority', async () => {
      mockQueryOne.mockResolvedValue({ priority: 'high', is_archived: true, is_deleted: false });

      const res = await request('/api/repos/owner/archived-repo/validate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.allowed).toBe(false);
      expect(body.reason).toBe('Repo is archived');
    });

    it('returns allowed=false for deleted repo', async () => {
      mockQueryOne.mockResolvedValue({ priority: 'high', is_archived: false, is_deleted: true });

      const res = await request('/api/repos/owner/deleted-repo/validate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.allowed).toBe(false);
      expect(body.reason).toBe('Repo is deleted');
    });

    it('returns found=false for unknown repo', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/repos/owner/unknown/validate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.found).toBe(false);
      expect(body.allowed).toBe(false);
      expect(body.reason).toBe('Repo not found in database');
    });
  });

  describe('GET /api/repos/allowed', () => {
    it('returns list of high priority repos', async () => {
      mockQuery.mockResolvedValue([
        { full_name: 'acme/tracker' },
        { full_name: 'acme/menu' },
      ]);

      const res = await request('/api/repos/allowed');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(2);
      expect(body.repos).toEqual(['acme/tracker', 'acme/menu']);
    });

    it('returns empty list when no high priority repos', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/repos/allowed');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(0);
      expect(body.repos).toEqual([]);
    });
  });
});
