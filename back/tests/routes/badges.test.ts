import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(),
  getRepoDetails: vi.fn(),
  getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(),
  checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import { createStorage } from '@back/infrastructure/storage';
import { compactNumber, renderBadge } from '@back/lib/badge';

const today = new Date().toISOString().slice(0, 10);
const gh = (name: string, extra: Record<string, unknown> = {}) => ({
  full_name: `acme/${name}`, owner: 'acme', name, is_private: false, is_archived: false, stars: 1234, ...extra,
});

let env: any;
// The same config object every time: storage is created once per config.
const get = (path: string, config: Record<string, unknown> = env) => app.request(path, {}, config);

describe('badge routes', () => {
  beforeEach(async () => {
    env = { ...mockEnv, STORAGE_DRIVER: 'memory', PUBLIC_BADGES: 'true' };
    const storage = createStorage(env);
    await storage.repos.refreshFromGitHub([gh('open'), gh('secret', { is_private: true }), gh('gone')]);
    await storage.repos.refreshFromGitHub([gh('open'), gh('secret', { is_private: true })]); // 'gone' is soft-deleted
    await storage.meta.patchRepoMeta('acme/open', { test_coverage: 91, has_ci: true, has_tests: true, has_readme: true });
    await storage.meta.bulkUpdateMeta([{ full_name: 'acme/open', loc: 48200 }]);
    await storage.traffic.upsertDaily('acme/open', [{ day: today, views: 1500, views_unique: 400, clones: 37, clones_unique: 20 }]);
    await storage.traffic.upsertDaily('acme/secret', [{ day: today, views: 999, views_unique: 9, clones: 9, clones_unique: 9 }]);
  });

  it('serves SVG badges for public repos without authentication', async () => {
    const res = await get('/api/badges/acme/open/stars.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const svg = await res.text();
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('<title>stars: 1.2k</title>');
  });

  it('renders every metric', async () => {
    const titles: Record<string, string> = {};
    for (const metric of ['stars', 'loc', 'views', 'clones', 'coverage', 'health']) {
      const svg = await (await get(`/api/badges/acme/open/${metric}.svg`)).text();
      titles[metric] = svg.match(/<title>(.*)<\/title>/)![1];
    }
    expect(titles).toMatchObject({
      stars: 'stars: 1.2k',
      loc: 'lines of code: 48.2k',
      views: 'views (14d): 1.5k',
      clones: 'clones (14d): 37',
      coverage: 'coverage: 91%',
    });
    expect(titles.health).toMatch(/^health: \d+\/100$/);
  });

  it('answers 404 for private, deleted and unknown repos alike, and for unknown metrics', async () => {
    const bodies = [];
    for (const path of [
      '/api/badges/acme/secret/views.svg',
      '/api/badges/acme/gone/stars.svg',
      '/api/badges/acme/nope/stars.svg',
      '/api/badges/acme/open/password.svg',
      '/api/badges/acme/open/stars',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1); // nothing reveals that the private repo exists
  });

  it('is off unless PUBLIC_BADGES is enabled', async () => {
    expect((await get('/api/badges/acme/open/stars.svg')).status).toBe(200);
    env.PUBLIC_BADGES = 'false';
    expect((await get('/api/badges/acme/open/stars.svg')).status).toBe(404);
    delete env.PUBLIC_BADGES;
    expect((await get('/api/badges/acme/open/stars.svg')).status).toBe(404);
  });

  it('does not open any other route', async () => {
    expect((await get('/api/repos')).status).toBe(401);
    expect((await get('/api/badges')).status).toBe(401);
  });
});

describe('badge rendering', () => {
  it('escapes text and sizes the badge to its content', () => {
    const svg = renderBadge('a<b>', '"x" & y', 'green');
    expect(svg).toContain('a&lt;b&gt;');
    expect(svg).toContain('&quot;x&quot; &amp; y');
    expect(svg).toContain('fill="#16a34a"');
    const width = (text: string) => Number(renderBadge('label', text).match(/width="(\d+)"/)![1]);
    expect(width('a much longer value')).toBeGreaterThan(width('short'));
    expect(renderBadge('l', 'v', 'not-a-color')).toContain('fill="#2563eb"');
  });

  it('abbreviates large numbers', () => {
    expect([0, 999, 1000, 1234, 48200, 1_500_000].map(compactNumber)).toEqual(['0', '999', '1k', '1.2k', '48.2k', '1.5M']);
  });
});
