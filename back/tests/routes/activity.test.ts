import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

// Mock DB client
const mockQuery = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: vi.fn(),
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

function request(path: string) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${mockEnv.API_KEY}` },
  }, mockEnv);
}

describe('activity routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/activity', () => {
    it('returns activities with default limit', async () => {
      const fakeRows = [
        { id: 1, action: 'priority.set', entity_type: 'repo', entity_id: 'owner/repo', field_changed: 'priority', old_value: null, new_value: 'high', actor_type: 'user', actor_name: 'admin', metadata: '{}', created_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValue(fakeRows);

      const res = await request('/api/activity');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.activities).toHaveLength(1);
      expect(body.activities[0].action).toBe('priority.set');
    });

    it('supports filters', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/activity?entityType=repo&actorType=user&limit=10');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.activities).toEqual([]);
    });

    it('returns 500 on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB down'));

      const res = await request('/api/activity');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Internal server error');
      expect(body.activities).toEqual([]);
    });
  });

  describe('GET /api/activity/stats/by-actor', () => {
    it('returns actor stats', async () => {
      mockQuery.mockResolvedValue([
        { actor_type: 'user', actor_name: 'admin', total_actions: '15', entities_touched: '5', last_activity: '2025-01-01' },
      ]);

      const res = await request('/api/activity/stats/by-actor');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.actors).toHaveLength(1);
      expect(body.actors[0].totalActions).toBe(15);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValue(new Error('query failed'));

      const res = await request('/api/activity/stats/by-actor');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.actors).toEqual([]);
    });
  });

  describe('GET /api/activity/stats/by-day', () => {
    it('returns daily stats', async () => {
      mockQuery.mockResolvedValue([
        { day: '2025-01-01', actor_type: 'user', actor_name: 'admin', actions: '8' },
      ]);

      const res = await request('/api/activity/stats/by-day');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.days).toHaveLength(1);
      expect(body.days[0].actions).toBe(8);
    });

    it('supports custom days parameter', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/activity/stats/by-day?days=30');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.days).toEqual([]);
    });
  });

  describe('GET /api/activity/count', () => {
    it('returns total count', async () => {
      mockQuery.mockResolvedValue([{ count: '42' }]);

      const res = await request('/api/activity/count');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(42);
    });

    it('returns filtered count', async () => {
      mockQuery.mockResolvedValue([{ count: '5' }]);

      const res = await request('/api/activity/count?entityType=repo');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.count).toBe(5);
    });
  });

  describe('GET /api/activity/repo/:fullName', () => {
    it('returns activities for a repo', async () => {
      const fakeRows = [
        { id: 1, action: 'health.update', entity_type: 'repo', entity_id: 'owner/repo', field_changed: null, old_value: null, new_value: null, actor_type: 'system', actor_name: 'sync', metadata: '{}', created_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValue(fakeRows);

      const res = await request('/api/activity/repo/owner%2Frepo');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.activities).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      const res = await request('/api/activity/repo/owner%2Frepo');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.activities).toEqual([]);
    });
  });

  describe('GET /api/activity/group/:slug', () => {
    it('returns activities for a group', async () => {
      const fakeRows = [
        { id: 2, action: 'group.add', entity_type: 'group', entity_id: 'web', field_changed: null, old_value: null, new_value: null, actor_type: 'user', actor_name: 'admin', metadata: '{}', created_at: '2025-01-01' },
      ];
      mockQuery.mockResolvedValue(fakeRows);

      const res = await request('/api/activity/group/web');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.activities).toHaveLength(1);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValue(new Error('fail'));

      const res = await request('/api/activity/group/web');
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.activities).toEqual([]);
    });
  });
});
