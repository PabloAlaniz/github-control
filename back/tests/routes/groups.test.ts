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

describe('groups routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/groups', () => {
    it('returns groups with repo_count', async () => {
      const fakeGroups = [
        { id: 1, slug: 'web', name: 'Web', repo_count: '3' },
        { id: 2, slug: 'api', name: 'API', repo_count: '1' },
      ];
      mockQuery.mockResolvedValue(fakeGroups);

      const res = await request('/api/groups');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(fakeGroups);
    });
  });

  describe('POST /api/groups', () => {
    it('creates a group with explicit slug', async () => {
      mockQueryOne.mockResolvedValue({ id: 5 });

      const res = await request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'infra', name: 'Infrastructure', description: 'Infra repos' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.id).toBe(5);
      expect(body.success).toBe(true);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        ['infra', 'Infrastructure', 'Infra repos', '#6366f1'],
      );
    });

    it('auto-generates slug from name when slug is not provided', async () => {
      mockQueryOne.mockResolvedValue({ id: 6 });

      const res = await request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Cool Group', description: 'desc', color: '#ff0000' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.id).toBe(6);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        ['my-cool-group', 'My Cool Group', 'desc', '#ff0000'],
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await request('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'no name' }),
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain('name is required');
    });
  });

  describe('PUT /api/groups/:id', () => {
    it('updates a group', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/groups/1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'web', name: 'Web Apps', description: 'Updated', color: '#ff0000' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('DELETE /api/groups/:id', () => {
    it('deletes a group', async () => {
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/groups/1', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/groups/:id/repos', () => {
    it('adds repo to group', async () => {
      mockQueryOne.mockResolvedValue({ id: 10 });
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/groups/1/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'owner/repo' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 when repo not found', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/groups/1/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'owner/missing' }),
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain('Repo not found');
    });
  });

  describe('DELETE /api/groups/:id/repos', () => {
    it('removes repo from group', async () => {
      mockQueryOne.mockResolvedValue({ id: 10 });
      mockQuery.mockResolvedValue([]);

      const res = await request('/api/groups/1/repos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'owner/repo' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 when repo not found', async () => {
      mockQueryOne.mockResolvedValue(null);

      const res = await request('/api/groups/1/repos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'owner/missing' }),
      });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toContain('Repo not found');
    });
  });
});
