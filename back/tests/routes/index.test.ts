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

// Mock GitHub lib
const mockGetAuthenticatedUser = vi.fn();
const mockGetAllOpenPRs = vi.fn();
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
  getAuthenticatedUser: (...args: any[]) => mockGetAuthenticatedUser(...args),
  getAllOpenPRs: (...args: any[]) => mockGetAllOpenPRs(...args),
}));

import app from '@back/index';

function request(path: string) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${mockEnv.API_KEY}` },
  }, mockEnv);
}

describe('index routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/stats', () => {
    it('returns stats parsed to int', async () => {
      mockQuery.mockResolvedValue([{
        total: '10', with_ci: '5', with_tests: '3',
        archived: '2', deleted: '1', paused: '0',
      }]);

      const res = await request('/api/stats');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        total: 10, withCi: 5, withTests: 3,
        archived: 2, deleted: 1, paused: 0,
      });
    });
  });

  describe('GET /api/user', () => {
    it('returns authenticated user', async () => {
      const fakeUser = { login: 'admin', id: 1, avatar_url: 'https://example.com/avatar' };
      mockGetAuthenticatedUser.mockResolvedValue(fakeUser);

      const res = await request('/api/user');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.login).toBe('admin');
    });

    it('returns 500 on error', async () => {
      mockGetAuthenticatedUser.mockRejectedValue(new Error('Token expired'));

      const res = await request('/api/user');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('Token expired');
    });
  });

  describe('GET /api/cache/status', () => {
    it('returns cache status', async () => {
      mockQueryOne.mockResolvedValue({ count: '42', latest: '2025-01-01T00:00:00Z' });

      const res = await request('/api/cache/status');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repoCount).toBe(42);
      expect(body.lastSync).toBe('2025-01-01T00:00:00Z');
    });

    it('returns defaults when no data', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/cache/status');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.repoCount).toBe(0);
      expect(body.lastSync).toBeNull();
    });
  });

  describe('GET /api/prs', () => {
    it('returns open PRs', async () => {
      const fakePRs = [
        { id: 1, title: 'Fix bug', updated_at: '2025-01-02' },
        { id: 2, title: 'Add feature', updated_at: '2025-01-01' },
      ];
      mockGetAllOpenPRs.mockResolvedValue(fakePRs);

      const res = await request('/api/prs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(2);
      expect(body.prs).toHaveLength(2);
    });

    it('returns 500 on error', async () => {
      mockGetAllOpenPRs.mockRejectedValue(new Error('Rate limited'));

      const res = await request('/api/prs');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('Rate limited');
    });
  });

  describe('GET /api/repos/:owner/:repo/prs', () => {
    it('returns PRs for specific repo', async () => {
      const fakePRs = [
        { id: 1, title: 'Fix', repository_url: 'https://api.github.com/repos/owner/repo', updated_at: '2025-01-01' },
        { id: 2, title: 'Other', repository_url: 'https://api.github.com/repos/owner/other', updated_at: '2025-01-01' },
      ];
      mockGetAllOpenPRs.mockResolvedValue(fakePRs);

      const res = await request('/api/repos/owner/repo/prs');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(1);
      expect(body.prs[0].title).toBe('Fix');
    });

    it('returns 500 on error', async () => {
      mockGetAllOpenPRs.mockRejectedValue(new Error('API error'));

      const res = await request('/api/repos/owner/repo/prs');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toContain('API error');
    });
  });
});

describe('settings on a deployment with fixed configuration', () => {
  const headers = { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json' };

  it('reports that settings are not editable', async () => {
    const res = await app.request('/api/settings', { headers }, mockEnv);
    expect(await res.json()).toEqual({ editable: false });
    const patch = await app.request('/api/settings', { method: 'PATCH', headers, body: '{}' }, mockEnv);
    expect(patch.status).toBe(501);
  });
});
