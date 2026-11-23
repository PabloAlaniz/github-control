import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

const mockOctokit = {
  repos: {
    getViews: vi.fn(),
    getClones: vi.fn(),
    getTopReferrers: vi.fn(),
    getTopPaths: vi.fn(),
  },
};
vi.mock('@back/lib/github/client', () => ({ getOctokit: () => mockOctokit }));
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import { createStorage } from '@back/infrastructure/storage';
import type { Storage } from '@back/application/ports/storage';

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

let env: any;
let storage: Storage;
const request = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);

describe('traffic routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env = { ...mockEnv, STORAGE_DRIVER: 'memory' };
    storage = createStorage(env);
    mockOctokit.repos.getViews.mockResolvedValue({ data: { views: [
      { timestamp: `${daysAgo(1)}T00:00:00Z`, count: 40, uniques: 12 },
      { timestamp: `${today}T00:00:00Z`, count: 9, uniques: 5 },
    ] } });
    mockOctokit.repos.getClones.mockResolvedValue({ data: { clones: [
      { timestamp: `${daysAgo(2)}T00:00:00Z`, count: 3, uniques: 2 },
      { timestamp: `${today}T00:00:00Z`, count: 1, uniques: 1 },
    ] } });
    mockOctokit.repos.getTopReferrers.mockResolvedValue({ data: [{ referrer: 'google.com', count: 20, uniques: 8 }] });
    mockOctokit.repos.getTopPaths.mockResolvedValue({ data: [{ path: '/acme/api', title: 'acme/api', count: 30, uniques: 10 }] });
  });

  it('stores what GitHub reports and serves it back per repo', async () => {
    const sync = await request('/api/traffic/repo/acme/api/sync', { method: 'POST' });
    expect(sync.status).toBe(200);
    expect(mockOctokit.repos.getViews).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', per: 'day' });

    const body = await (await request('/api/traffic/repo/acme/api?days=7')).json();
    expect(body).toEqual({
      repo: 'acme/api',
      days: 7,
      daily: [
        { day: daysAgo(2), views: 0, views_unique: 0, clones: 3, clones_unique: 2 },
        { day: daysAgo(1), views: 40, views_unique: 12, clones: 0, clones_unique: 0 },
        { day: today, views: 9, views_unique: 5, clones: 1, clones_unique: 1 },
      ],
      referrers: { day: today, sources: [{ label: 'google.com', title: null, hits: 20, uniques: 8 }] },
      paths: { day: today, sources: [{ label: '/acme/api', title: 'acme/api', hits: 30, uniques: 10 }] },
    });
  });

  it('keeps days that GitHub no longer returns', async () => {
    await storage.traffic.upsertDaily('acme/api', [{ day: daysAgo(20), views: 70, views_unique: 30, clones: 0, clones_unique: 0 }]);
    await request('/api/traffic/repo/acme/api/sync', { method: 'POST' });
    const body = await (await request('/api/traffic/repo/acme/api?days=30')).json();
    expect(body.daily.map((d: any) => d.day)).toEqual([daysAgo(20), daysAgo(2), daysAgo(1), today]);
  });

  it('summarizes all repos, most viewed first', async () => {
    await storage.traffic.upsertDaily('acme/api', [{ day: today, views: 10, views_unique: 4, clones: 2, clones_unique: 1 }]);
    await storage.traffic.upsertDaily('acme/web', [{ day: today, views: 50, views_unique: 20, clones: 0, clones_unique: 0 }]);
    await storage.traffic.upsertDaily('acme/web', [{ day: daysAgo(60), views: 999, views_unique: 1, clones: 0, clones_unique: 0 }]);

    const body = await (await request('/api/traffic/summary')).json();
    expect(body.days).toBe(14);
    expect(body.totals).toEqual({ views: 60, views_unique: 24, clones: 2, clones_unique: 1 });
    expect(body.repos.map((r: any) => [r.full_name, r.views])).toEqual([['acme/web', 50], ['acme/api', 10]]);
    expect(body.daily).toEqual([{ day: today, views: 60, views_unique: 24, clones: 2, clones_unique: 1 }]);

    const wide = await (await request('/api/traffic/summary?days=90')).json();
    expect(wide.totals.views).toBe(1059);
    const bogus = await (await request('/api/traffic/summary?days=abc')).json();
    expect(bogus.days).toBe(14);
  });

  it('explains when the token cannot read traffic, and reports other failures', async () => {
    mockOctokit.repos.getViews.mockRejectedValue(Object.assign(new Error('Must have push access'), { status: 403 }));
    const denied = await request('/api/traffic/repo/acme/api/sync', { method: 'POST' });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatch(/push access/);
    expect(await storage.traffic.getDaily('acme/api', 30)).toEqual([]);

    mockOctokit.repos.getViews.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const failed = await request('/api/traffic/repo/acme/api/sync', { method: 'POST' });
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toBe('Traffic sync failed: boom');
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/traffic/summary', {}, env)).status).toBe(401);
  });
});
