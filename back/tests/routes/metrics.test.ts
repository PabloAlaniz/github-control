import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock DB client
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(),
}));

// Mock GitHub lib (required by index.ts imports)
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
  calculateDocsQuality: vi.fn(),
  detectRepoApps: vi.fn(),
  getRepoTree: vi.fn(),
  checkAppHealth: vi.fn(),
  getOctokit: vi.fn(),
}));

vi.mock('@back/lib/analyzers/pipeline', () => ({
  runPipeline: vi.fn(),
  runAppPipeline: vi.fn(),
}));

vi.mock('@back/lib/analyzers/github-enricher', () => ({
  enrichFromGitHub: vi.fn(),
}));

import app from '@back/index';

function request(path: string) {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  return app.request(path, { headers }, mockEnv);
}

describe('metrics routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
  });

  // ── GET /api/metrics/repo/:owner/:repo ──────────────

  describe('GET /api/metrics/repo/:owner/:repo', () => {
    it('returns historical metrics for a repo', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          snapshot_date: '2026-03-01', repo_size_kb: 512, file_count: 30, loc: 5000,
          stars: 10, forks: 2, watchers: 5, subscribers_count: 3, open_issues: 1,
          has_ci: true, has_tests: true, has_readme: true, readme_lines: 100,
          docs_quality: 'good', docs_file_count: 3,
        },
      ]);

      const res = await request('/api/metrics/repo/owner/repo');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repo).toBe('owner/repo');
      expect(body.days).toBe(30);
      expect(body.snapshots).toHaveLength(1);
      expect(body.snapshots[0].code.loc).toBe(5000);
      expect(body.snapshots[0].github.stars).toBe(10);
      expect(body.snapshots[0].health.docsQuality).toBe('good');
    });

    it('respects custom days param', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/metrics/repo/owner/repo?days=7');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.days).toBe(7);
      expect(body.snapshots).toEqual([]);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));

      const res = await request('/api/metrics/repo/owner/repo');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.snapshots).toEqual([]);
    });
  });

  // ── GET /api/metrics/snapshot/:date ──────────────────

  describe('GET /api/metrics/snapshot/:date', () => {
    it('returns metrics snapshot for a date', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          full_name: 'owner/repo', snapshot_date: '2026-03-01',
          repo_size_kb: 100, file_count: 10, loc: 1000,
          stars: 5, forks: 1, watchers: 3, subscribers_count: 2, open_issues: 0,
          has_ci: true, has_tests: false, has_readme: true, readme_lines: 50,
          docs_quality: 'needs_work', docs_file_count: 1,
          language: 'TypeScript', is_private: false, is_archived: false,
        },
      ]);

      const res = await request('/api/metrics/snapshot/2026-03-01');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.date).toBe('2026-03-01');
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0].fullName).toBe('owner/repo');
      expect(body.repos[0].meta.language).toBe('TypeScript');
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('timeout'));

      const res = await request('/api/metrics/snapshot/2026-03-01');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.repos).toEqual([]);
    });
  });

  // ── GET /api/metrics/aggregate ───────────────────────

  describe('GET /api/metrics/aggregate', () => {
    it('returns aggregate metrics', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          snapshot_date: '2026-03-01', total_repos: '10',
          total_loc: '50000', total_files: '300', total_size_kb: '10000',
          total_stars: '100', total_forks: '20', total_open_issues: '15',
          repos_with_ci: '8', repos_with_tests: '7', repos_with_readme: '9',
          repos_docs_excellent: '3', repos_docs_good: '4',
          repos_docs_needs_work: '2', repos_docs_missing: '1',
        },
      ]);

      const res = await request('/api/metrics/aggregate');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.days).toBe(30);
      expect(body.snapshots).toHaveLength(1);
      expect(body.snapshots[0].totalRepos).toBe(10);
      expect(body.snapshots[0].code.totalLoc).toBe(50000);
      expect(body.snapshots[0].health.docsQuality.excellent).toBe(3);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection failed'));

      const res = await request('/api/metrics/aggregate');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  // ── GET /api/metrics/latest ──────────────────────────

  describe('GET /api/metrics/latest', () => {
    it('returns latest snapshot date', async () => {
      mockQuery.mockResolvedValueOnce([{ latest: '2026-03-01' }]);

      const res = await request('/api/metrics/latest');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.latestSnapshot).toBe('2026-03-01');
    });

    it('returns null when no snapshots exist', async () => {
      mockQuery.mockResolvedValueOnce([{ latest: null }]);

      const res = await request('/api/metrics/latest');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.latestSnapshot).toBeNull();
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('query failed'));

      const res = await request('/api/metrics/latest');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });

  // ── GET /api/metrics/compare ─────────────────────────

  describe('GET /api/metrics/compare', () => {
    it('returns 400 when missing params', async () => {
      const res = await request('/api/metrics/compare');
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('Missing required query params');
    });

    it('returns 400 when missing "to" param', async () => {
      const res = await request('/api/metrics/compare?from=2026-02-01');
      const body = await res.json();

      expect(res.status).toBe(400);
    });

    it('compares two snapshots', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          full_name: 'owner/repo',
          loc_delta: '500', file_count_delta: '10', repo_size_kb_delta: '50',
          stars_delta: '2', forks_delta: '1', open_issues_delta: '-1',
          current_loc: '5500', current_file_count: '110',
          current_stars: '12', from_loc: '5000',
          is_new: false, is_removed: false,
        },
      ]);

      const res = await request('/api/metrics/compare?from=2026-02-01&to=2026-03-01');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.from).toBe('2026-02-01');
      expect(body.to).toBe('2026-03-01');
      expect(body.changes).toHaveLength(1);
      expect(body.changes[0].repo).toBe('owner/repo');
      expect(body.changes[0].deltas.loc).toBe(500);
      expect(body.changes[0].isNew).toBe(false);
    });

    it('handles is_new and is_removed flags', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          full_name: 'owner/new-repo', loc_delta: '0', file_count_delta: '0',
          repo_size_kb_delta: '0', stars_delta: '0', forks_delta: '0', open_issues_delta: '0',
          current_loc: '1000', current_file_count: '20', current_stars: '0', from_loc: '0',
          is_new: true, is_removed: false,
        },
      ]);

      const res = await request('/api/metrics/compare?from=2026-02-01&to=2026-03-01');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.changes[0].isNew).toBe(true);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('compare failed'));

      const res = await request('/api/metrics/compare?from=2026-02-01&to=2026-03-01');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
    });
  });
});
