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
}));

// Mock global fetch for health checks
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import the app AFTER mocks are set up
import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  }
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('services routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockFetch.mockReset();
  });

  // ── LIST ──────────────────────────────────────

  describe('GET /api/services', () => {
    it('returns all services', async () => {
      const fakeServices = [
        { id: 1, name: 'API', slug: 'api', provider: 'gcp', repo_language: 'TypeScript' },
        { id: 2, name: 'Web', slug: 'web', provider: 'cloudflare', repo_language: null },
      ];
      mockQuery.mockResolvedValueOnce(fakeServices);

      const res = await request('/api/services');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe('API');
    });

    it('filters by provider', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await request('/api/services?provider=gcp');

      expect(mockQuery).toHaveBeenCalledWith(
        mockEnv,
        expect.stringContaining('s.provider = $1'),
        ['gcp']
      );
    });

    it('filters by source_repo', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await request('/api/services?source_repo=owner/repo');

      expect(mockQuery).toHaveBeenCalledWith(
        mockEnv,
        expect.stringContaining('s.source_repo_full_name = $1'),
        ['owner/repo']
      );
    });
  });

  // ── GET BY SLUG ──────────────────────────────────────

  describe('GET /api/services/:slug', () => {
    it('returns a service', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, name: 'API', slug: 'api', provider: 'gcp' });

      const res = await request('/api/services/api');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe('API');
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/services/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ── CREATE ──────────────────────────────────────

  describe('POST /api/services', () => {
    it('creates a service', async () => {
      // INSERT RETURNING
      mockQueryOne.mockResolvedValueOnce({ id: 1, slug: 'my-api' });
      // logActivity INSERT (uses query, not queryOne)
      mockQuery.mockResolvedValueOnce([{ id: 1 }]);

      const res = await request('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My API', provider: 'gcp', url: 'https://api.example.com' }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.slug).toBe('my-api');
    });

    it('returns 400 without name', async () => {
      const res = await request('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gcp' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 without provider', async () => {
      const res = await request('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My API' }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ── UPDATE ──────────────────────────────────────

  describe('PUT /api/services/:slug', () => {
    it('updates a service', async () => {
      // 1. queryOne: existence check
      mockQueryOne.mockResolvedValueOnce({ id: 1 });
      // 2. query: UPDATE
      // 3. query: logActivity INSERT
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 1 }]);

      const res = await request('/api/services/my-api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated API' }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/services/nonexistent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ── DELETE ──────────────────────────────────────

  describe('DELETE /api/services/:slug', () => {
    it('deletes a service', async () => {
      // 1. queryOne: existence check
      mockQueryOne.mockResolvedValueOnce({ id: 1, name: 'My API' });
      // 2. query: DELETE
      // 3. query: logActivity INSERT
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 1 }]);

      const res = await request('/api/services/my-api', { method: 'DELETE' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/services/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  // ── HEALTH CHECK ──────────────────────────────────────

  describe('POST /api/services/:slug/health-check', () => {
    it('returns healthy for 200 response', async () => {
      // 1. queryOne: find service
      mockQueryOne.mockResolvedValueOnce({ id: 1, url: 'https://api.example.com', name: 'My API' });
      // fetch returns 200
      mockFetch.mockResolvedValueOnce({ status: 200 });
      // 2. query: UPDATE health
      // 3. query: logActivity INSERT
      mockQuery
        .mockResolvedValueOnce([])           // UPDATE services (latest status)
        .mockResolvedValueOnce([])           // INSERT service_checks (history)
        .mockResolvedValueOnce([{ id: 1 }]); // activity log

      const res = await request('/api/services/my-api/health-check', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.httpCode).toBe(200);
      expect(body.responseMs).toBeDefined();
    });

    it('returns down for 500 response', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, url: 'https://api.example.com', name: 'My API' });
      mockFetch.mockResolvedValueOnce({ status: 500 });
      mockQuery
        .mockResolvedValueOnce([])           // UPDATE services (latest status)
        .mockResolvedValueOnce([])           // INSERT service_checks (history)
        .mockResolvedValueOnce([{ id: 1 }]); // activity log

      const res = await request('/api/services/my-api/health-check', { method: 'POST' });
      const body = await res.json();

      expect(body.status).toBe('down');
      expect(body.httpCode).toBe(500);
    });

    it('returns down for fetch error', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, url: 'https://api.example.com', name: 'My API' });
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
      mockQuery
        .mockResolvedValueOnce([])           // UPDATE services (latest status)
        .mockResolvedValueOnce([])           // INSERT service_checks (history)
        .mockResolvedValueOnce([{ id: 1 }]); // activity log

      const res = await request('/api/services/my-api/health-check', { method: 'POST' });
      const body = await res.json();

      expect(body.status).toBe('down');
      expect(body.httpCode).toBeNull();
    });

    it('returns 404 for unknown slug', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await request('/api/services/nonexistent/health-check', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for service without URL', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, url: null, name: 'My API' });

      const res = await request('/api/services/no-url/health-check', { method: 'POST' });

      expect(res.status).toBe(400);
    });
  });

  // ── BATCH HEALTH CHECK ──────────────────────────────────────

  describe('POST /api/services/health-check-all', () => {
    it('checks all active services', async () => {
      // 1. query: SELECT active services
      mockQuery.mockResolvedValueOnce([
        { slug: 'api', url: 'https://api.example.com', name: 'API' },
        { slug: 'web', url: 'https://web.example.com', name: 'Web' },
      ]);
      mockFetch
        .mockResolvedValueOnce({ status: 200 })
        .mockResolvedValueOnce({ status: 503 });
      // UPDATE queries for each service (use mockResolvedValueOnce for each)
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE service 1
        .mockResolvedValueOnce([]) // UPDATE service 2
      ;

      const res = await request('/api/services/health-check-all', { method: 'POST' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.total).toBe(2);
      expect(body.results).toHaveLength(2);
    });
  });

  // ── BY REPO ──────────────────────────────────────

  describe('GET /api/services/by-repo/:owner/:repo', () => {
    it('returns services for a repo', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 1, name: 'Menu API', slug: 'menu-api', source_repo_full_name: 'acme/menu-api' },
      ]);

      const res = await request('/api/services/by-repo/acme/menu-api');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        mockEnv,
        expect.stringContaining('source_repo_full_name = $1'),
        ['acme/menu-api']
      );
    });

    it('returns empty array for repo with no services', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await request('/api/services/by-repo/owner/no-services');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([]);
    });
  });
});
