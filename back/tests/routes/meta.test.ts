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

// Mock GitHub lib (required because index.ts imports it)
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  }
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('meta routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/meta', () => {
    it('returns aggregations by priority and stack', async () => {
      mockQuery
        .mockResolvedValueOnce([{ priority: 'high', count: 3 }, { priority: 'low', count: 1 }])
        .mockResolvedValueOnce([{ stack: 'node', count: 5 }]);

      const res = await request('/api/meta');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.priorities).toEqual([{ priority: 'high', count: 3 }, { priority: 'low', count: 1 }]);
      expect(body.stacks).toEqual([{ stack: 'node', count: 5 }]);
    });
  });

  describe('GET /api/meta/:owner/:repo', () => {
    it('returns repo meta when found', async () => {
      const fakeMeta = { priority: 'high', next_action: 'deploy' };
      mockQueryOne.mockResolvedValue(fakeMeta);

      const res = await request('/api/meta/owner/repo');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(fakeMeta);
    });

    it('returns 404 when repo not found', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/meta/owner/missing');
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain('Repo not found');
    });
  });

  describe('PATCH /api/meta/:owner/:repo', () => {
    it('updates valid fields', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'high', stack: 'node' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('ignores invalid fields but updates valid ones', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'low', invalid_field: 'nope' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 400 when no valid fields provided', async () => {
      const res = await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad_field: 'nope' }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('No valid fields');
    });

    it('updates the notes field', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'migrar auth a JWT antes de junio' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('logs a meta.notes activity when notes change', async () => {
      mockQuery.mockResolvedValue([]);

      await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Name': 'alice' },
        body: JSON.stringify({ notes: 'nota interna' }),
      });

      const activityInsert = mockQuery.mock.calls.find(
        ([, sql]) => typeof sql === 'string' && sql.includes('activity_log')
      );
      expect(activityInsert).toBeDefined();
      expect(activityInsert![2]).toContain('meta.notes');
      expect(activityInsert![2]).toContain('alice');
    });

    it('does not log activity when notes are not part of the update', async () => {
      mockQuery.mockResolvedValue([]);

      await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'high' }),
      });

      const activityInsert = mockQuery.mock.calls.find(
        ([, sql]) => typeof sql === 'string' && sql.includes('activity_log')
      );
      expect(activityInsert).toBeUndefined();
    });

    it('accepts health check fields (has_gitignore, last_health_check)', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/meta/owner/repo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          has_gitignore: true, 
          last_health_check: '2026-02-23T07:00:00Z' 
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/meta/bulk', () => {
    it('updates multiple repos', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/meta/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { full_name: 'owner/repo1', priority: 'high' },
            { full_name: 'owner/repo2', priority: 'low' },
          ],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.updated).toBe(2);
    });

    it('handles empty updates array', async () => {
      const res = await request('/api/meta/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [] }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.updated).toBe(0);
    });
  });
});
