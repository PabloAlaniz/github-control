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
const mockGetRepoTree = vi.fn();
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
  calculateDocsQuality: vi.fn(),
  detectRepoApps: vi.fn(),
  getRepoTree: (...args: any[]) => mockGetRepoTree(...args),
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

// Mock syncAppHealth
const mockSyncAppHealth = vi.fn();
vi.mock('@back/services/health-sync.service', () => ({
  syncAppHealth: (...args: any[]) => mockSyncAppHealth(...args),
  NotFoundError: class NotFoundError extends Error {},
}));

import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('repo-apps routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockGetRepoTree.mockReset();
    mockSyncAppHealth.mockReset();
  });

  // ── GET /api/repo-apps ──────────────────────────

  describe('GET /api/repo-apps', () => {
    it('returns all apps', async () => {
      mockQuery.mockResolvedValueOnce([{ slug: 'app1' }, { slug: 'app2' }]);

      const res = await request('/api/repo-apps');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
    });
  });

  // ── GET /api/repo-apps/:slug ────────────────────

  describe('GET /api/repo-apps/:slug', () => {
    it('returns an app by slug', async () => {
      mockQueryOne.mockResolvedValueOnce({ slug: 'my-app', app_name: 'Web' });

      const res = await request('/api/repo-apps/my-app');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.app_name).toBe('Web');
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/repo-apps/unknown');
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/repo-apps ─────────────────────────

  describe('POST /api/repo-apps', () => {
    it('creates an app', async () => {
      // upsertApp
      mockQueryOne.mockResolvedValueOnce({ id: 1, slug: 'o-r-web' });
      // logActivity
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_full_name: 'owner/repo', app_path: 'apps/web', app_name: 'web',
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.slug).toBe('o-r-web');
    });

    it('returns 400 when missing required fields', async () => {
      const res = await request('/api/repo-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_full_name: 'owner/repo' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ── PUT /api/repo-apps/:slug ────────────────────

  describe('PUT /api/repo-apps/:slug', () => {
    it('updates an app', async () => {
      // getApp
      mockQueryOne.mockResolvedValueOnce({ slug: 'my-app' });
      // updateApp
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/my-app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: 'Updated' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/repo-apps/unknown', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_name: 'X' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /api/repo-apps/:slug ─────────────────

  describe('DELETE /api/repo-apps/:slug', () => {
    it('deletes an app', async () => {
      // getAppForDelete
      mockQueryOne.mockResolvedValueOnce({ id: 1, app_name: 'web' });
      // deleteApp
      mockQuery.mockResolvedValueOnce([]);
      // logActivity
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/my-app', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/repo-apps/unknown', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/repo-apps/:slug/health/sync ──────

  describe('POST /api/repo-apps/:slug/health/sync', () => {
    it('syncs health for an app', async () => {
      // getAppBasic
      mockQueryOne.mockResolvedValueOnce({
        id: 1, repo_full_name: 'owner/repo', app_path: 'apps/web', app_name: 'web',
      });
      // syncAppHealth
      mockSyncAppHealth.mockResolvedValueOnce({
        hasCi: true, hasTests: true, loc: 5000, fileCount: 50,
      });
      // logActivity
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/my-app/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.health.loc).toBe(5000);
    });

    it('returns 404 for unknown app', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/repo-apps/unknown/health/sync', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on sync error', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 1, repo_full_name: 'owner/repo', app_path: 'apps/web', app_name: 'web',
      });
      mockSyncAppHealth.mockRejectedValueOnce(new Error('GitHub API failed'));

      const res = await request('/api/repo-apps/my-app/health/sync', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('GitHub API failed');
    });
  });

  // ── POST /api/repo-apps/sync-by-repo/:owner/:repo

  describe('POST /api/repo-apps/sync-by-repo/:owner/:repo', () => {
    it('returns synced:0 when no apps', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/sync-by-repo/owner/repo', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(0);
    });

    it('syncs all apps with shared tree', async () => {
      // listAppsByRepo
      mockQuery.mockResolvedValueOnce([
        { id: 1, slug: 'o-r-web', app_path: 'apps/web', app_name: 'web' },
        { id: 2, slug: 'o-r-api', app_path: 'apps/api', app_name: 'api' },
      ]);
      // getRepoTree
      mockGetRepoTree.mockResolvedValueOnce([{ path: 'apps/web/index.ts' }]);
      // syncAppHealth for each app
      mockSyncAppHealth
        .mockResolvedValueOnce({ hasCi: true, loc: 1000, fileCount: 10 })
        .mockResolvedValueOnce({ hasCi: false, loc: 500, fileCount: 5 });
      // logActivity
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/sync-by-repo/owner/repo', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(2);
      expect(body.results).toHaveLength(2);
    });

    it('handles mixed success/failure in batch', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, slug: 'o-r-web', app_path: 'apps/web', app_name: 'web' },
        { id: 2, slug: 'o-r-api', app_path: 'apps/api', app_name: 'api' },
      ]);
      mockGetRepoTree.mockResolvedValueOnce([]);
      mockSyncAppHealth
        .mockResolvedValueOnce({ loc: 1000 })
        .mockRejectedValueOnce(new Error('timeout'));
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/repo-apps/sync-by-repo/owner/repo', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.synced).toBe(1);
      expect(body.results[1].error).toBe('timeout');
    });

    it('returns 500 when tree fetch fails', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 1, slug: 'x', app_path: 'a', app_name: 'a' }]);
      mockGetRepoTree.mockRejectedValueOnce(new Error('rate limited'));

      const res = await request('/api/repo-apps/sync-by-repo/owner/repo', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('rate limited');
    });
  });
});
