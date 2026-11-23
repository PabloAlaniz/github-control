import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

const mockRepoGet = vi.fn();
const mockGetBranch = vi.fn();
const mockGetTree = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    repos: { get: mockRepoGet, getBranch: mockGetBranch },
    git: { getTree: mockGetTree },
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { SIGNAL_KINDS } from '@back/lib/signals';
import { groupSignals } from '@back/services/signal.service';

let env: any;
let storage: Storage;
const request = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
const sync = (qs = '', repo = 'acme/api') => request(`/api/repos/${repo}/signals/sync${qs}`, { method: 'POST' });

describe('signals routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([repoRecord('acme/api'), repoRecord('acme/web')]);
    mockRepoGet.mockResolvedValue({ data: { default_branch: 'main', description: 'd', topics: [], private: true } });
    mockGetBranch.mockResolvedValue({ data: { protected: false } });
    mockGetTree.mockResolvedValue({ data: { tree: [] } });
  });

  describe('POST /api/repos/:owner/:repo/signals/sync', () => {
    it('collects the requested kind and stores it', async () => {
      const body = await (await sync('?kinds=standards')).json();

      expect(body).toMatchObject({ repo: 'acme/api', ok: true });
      expect(body.results).toHaveLength(1);
      const [stored] = await storage.signals.getRepoSignals('acme/api');
      expect(stored).toMatchObject({ kind: 'standards', data: { passed: 1, total: 4 } });
    });

    it('runs every registered kind by default, each failing on its own', async () => {
      const body = await (await sync()).json();

      // The Octokit of this test only covers what `standards` and `config` need.
      expect(body.results.map((r: any) => r.kind)).toEqual(SIGNAL_KINDS);
      expect(body.results.find((r: any) => r.kind === 'standards').ok).toBe(true);
      expect(body.ok).toBe(false);
      expect((await storage.signals.getRepoSignals('acme/api')).map(r => r.kind)).toContain('standards');
    });

    it('rejects unknown kinds', async () => {
      const res = await sync('?kinds=standards,nope');
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('nope');
      expect(mockRepoGet).not.toHaveBeenCalled();
    });

    it('returns 404 for a repo the store does not know', async () => {
      expect((await sync('?kinds=standards', 'acme/ghost')).status).toBe(404);
    });

    it('reports a failing kind without failing the request', async () => {
      mockRepoGet.mockRejectedValueOnce(new Error('rate limited')).mockRejectedValueOnce({});

      const first = await (await sync('?kinds=standards')).json();
      expect(first.results[0]).toEqual({ kind: 'standards', ok: false, error: 'rate limited' });
      expect((await (await sync('?kinds=standards')).json()).results[0].error).toBe('unknown error');
      expect(await storage.signals.getRepoSignals('acme/api')).toEqual([]);
    });
  });

  describe('reading signals', () => {
    beforeEach(async () => {
      await storage.signals.upsertSignal('acme/api', 'standards', { passed: 4, total: 4 });
      await storage.signals.upsertSignal('acme/api', 'dependencies', { total: 2, items: [{ name: 'hono' }, { name: 'zod' }] });
    });

    it('returns the full detail for one repo', async () => {
      const body = await (await request('/api/repos/acme/api/signals')).json();

      expect(body.repo).toBe('acme/api');
      expect(body.signals.standards).toMatchObject({ passed: 4, total: 4, checked_at: expect.any(String) });
      expect(body.signals.dependencies.items).toHaveLength(2);
      expect((await (await request('/api/repos/acme/web/signals')).json()).signals).toEqual({});
    });

    it('attaches a summary (without item lists) to the repo list and feeds the health score', async () => {
      const repos = await (await request('/api/repos')).json();
      const api = repos.find((r: any) => r.full_name === 'acme/api');
      const web = repos.find((r: any) => r.full_name === 'acme/web');

      expect(api.signals.dependencies).toEqual({ total: 2, checked_at: expect.any(String) });
      expect(api.health_score.breakdown.hygiene.checks.map((c: any) => c.key)).toContain('standards');
      expect(web.signals).toEqual({});
      expect(web.health_score.breakdown.hygiene.checks.map((c: any) => c.key)).not.toContain('standards');

      const score = await (await request('/api/repos/acme/api/health-score')).json();
      expect(score.breakdown.hygiene.checks.find((c: any) => c.key === 'standards').earned).toBe(4);
    });
  });

  it('groupSignals handles no records', () => {
    expect(groupSignals([]).size).toBe(0);
  });
});
