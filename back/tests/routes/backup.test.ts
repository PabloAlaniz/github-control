import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockGetDb = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: (...args: any[]) => mockGetDb(...args),
}));

// The backup route reads groups + edges + repos. We also need the meta repo (uses query()).
// All come from the same client mock above.

import app from '@back/index';

function request(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${mockEnv.API_KEY}`);
  return app.request(path, { ...options, headers }, mockEnv);
}

describe('backup routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/export', () => {
    it('returns version 1 snapshot with groups, edges, and meta overrides', async () => {
      // listGroups → 2 groups
      mockQuery.mockResolvedValueOnce([
        { id: 1, slug: 'prod', name: 'Production', description: null, color: '#22c55e' },
        { id: 2, slug: 'side', name: 'Side', description: 'misc', color: '#3b82f6' },
      ]);
      // listAllRepoGroupEdges → 2 edges
      mockQuery.mockResolvedValueOnce([
        { repo_full_name: 'o/a', group_slug: 'prod' },
        { repo_full_name: 'o/b', group_slug: 'side' },
      ]);
      // listRepos → 3 repos, only 2 have meta overrides
      mockQuery.mockResolvedValueOnce([
        { full_name: 'o/a', priority: 'high', local_status: null, client: null, notes: null, next_action: null, blockers: [] },
        { full_name: 'o/b', priority: null, local_status: 'reviewed', client: 'Acme', notes: 'cool', next_action: null, blockers: ['legal'] },
        { full_name: 'o/c', priority: null, local_status: null, client: null, notes: null, next_action: null, blockers: [] },
      ]);

      mockQuery.mockResolvedValueOnce([]);  // saved views

      const res = await request('/api/export');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.version).toBe(1);
      expect(body.exported_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(body.groups).toHaveLength(2);
      expect(body.groups[0]).toEqual({ slug: 'prod', name: 'Production', description: null, color: '#22c55e' });
      expect(body.repo_groups).toHaveLength(2);
      expect(body.meta_overrides).toHaveLength(2);  // o/a and o/b; o/c excluded
      expect(body.meta_overrides[0].full_name).toBe('o/a');
    });
  });

  describe('POST /api/import', () => {
    it('rejects invalid JSON', async () => {
      const res = await request('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });

    it('rejects schema mismatch', async () => {
      const res = await request('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects unsupported version', async () => {
      const res = await request('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 99 }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('Unsupported export version');
    });

    it('upserts groups, links repo_groups, and applies meta overrides', async () => {
      // Setup mocks in order the route calls them:
      // For each group: upsertGroupBySlug (queryOne) — 2 calls
      mockQueryOne.mockResolvedValueOnce({ id: 10 });
      mockQueryOne.mockResolvedValueOnce({ id: 11 });
      // For each edge: getRepoId (queryOne) — 1 call (we have 1 edge)
      mockQueryOne.mockResolvedValueOnce({ id: 100 });
      // addRepoToGroup uses query() (not queryOne)
      mockQuery.mockResolvedValueOnce(undefined);
      // patchRepoMeta uses query()
      mockQuery.mockResolvedValueOnce([{}]);  // truthy result = applied

      const body = {
        version: 1,
        groups: [
          { slug: 'prod', name: 'Production', color: '#22c55e' },
          { slug: 'side', name: 'Side' },
        ],
        repo_groups: [
          { repo_full_name: 'o/a', group_slug: 'prod' },
        ],
        meta_overrides: [
          { full_name: 'o/a', priority: 'high', notes: 'top repo' },
        ],
      };

      const res = await request('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json();

      expect(res.status).toBe(200);
      expect(out.success).toBe(true);
      expect(out.summary.groups_upserted).toBe(2);
      expect(out.summary.repo_groups_added).toBe(1);
      expect(out.summary.meta_applied).toBe(1);
    });

    it('skips repo_groups edges when repo is missing from cache', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 10 });  // group upsert
      mockQueryOne.mockResolvedValueOnce(null);  // getRepoId — repo missing

      const res = await request('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          groups: [{ slug: 'prod', name: 'Production' }],
          repo_groups: [{ repo_full_name: 'unknown/repo', group_slug: 'prod' }],
          meta_overrides: [],
        }),
      });
      const out = await res.json();
      expect(out.summary.repo_groups_skipped_missing_repo).toBe(1);
      expect(out.summary.repo_groups_added).toBe(0);
    });
  });
});
