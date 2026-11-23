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

describe('more badges, cards and the summary', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(async () => {
    env = { ...mockEnv, STORAGE_DRIVER: 'memory', PUBLIC_BADGES: 'true' };
    storage = createStorage(env);
    await storage.repos.refreshFromGitHub([
      gh('open', { description: 'An <open> API & more', language: 'TypeScript', stars: 1234 }),
      gh('other', { stars: 66, is_archived: true }),
      gh('secret', { is_private: true, stars: 5000 }),
    ]);
    await storage.meta.bulkUpdateMeta([{ full_name: 'acme/open', loc: 48200 }, { full_name: 'acme/secret', loc: 900000 }]);
    await storage.health.updateCiStatus('acme/open', { ci_status: 'success', ci_status_url: null, ci_status_run_at: null });
    await storage.signals.upsertSignal('acme/open', 'release', { hasRelease: true, tag: 'v2.1.0', downloads: 15300 });
    await storage.signals.upsertSignal('acme/secret', 'release', { hasRelease: true, tag: 'v9', downloads: 777777 });
    await storage.traffic.upsertDaily('acme/open', [{ day: today, views: 1500, views_unique: 400, clones: 37, clones_unique: 20 }]);
    await storage.traffic.upsertDaily('acme/secret', [{ day: today, views: 99999, views_unique: 9, clones: 9, clones_unique: 9 }]);
  });

  it('serves CI, release and download badges', async () => {
    expect(await (await get('/api/badges/acme/open/ci.svg')).text()).toContain('aria-label="CI: passing"');
    expect(await (await get('/api/badges/acme/open/release.svg')).text()).toContain('aria-label="release: v2.1.0"');
    expect(await (await get('/api/badges/acme/open/downloads.svg')).text()).toContain('aria-label="downloads: 15.3k"');

    expect(await (await get('/api/badges/acme/other/ci.svg')).text()).toContain('aria-label="CI: unknown"');
    expect(await (await get('/api/badges/acme/other/release.svg')).text()).toContain('aria-label="release: none"');
    expect(await (await get('/api/badges/acme/other/downloads.svg')).text()).toContain('aria-label="downloads: unknown"');
  });

  it('accepts a custom label and a square style, escaping what it is given', async () => {
    const svg = await (await get('/api/badges/acme/open/stars.svg?label=%3Cb%3EGitHub%20stars&style=flat-square')).text();
    expect(svg).toContain('aria-label="&lt;b&gt;GitHub stars: 1.2k"');
    expect(svg).toContain('rx="0"');
    expect(await (await get('/api/badges/acme/open/stars.svg?style=nope')).text()).toContain('rx="3"');
  });

  it('serves a card per public repo, in the requested theme', async () => {
    const res = await get('/api/badges/acme/open/card.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('image/svg+xml');
    const svg = await res.text();
    expect(svg).toContain('>acme/open</text>');
    expect(svg).toContain('An &lt;open&gt; API &amp; more');
    expect(svg).toContain('TypeScript   ·   ★ 1.2k   ·   v2.1.0');
    expect(svg).toContain('fill="#3178c6"');
    expect(svg).toContain('prefers-color-scheme:dark');

    const dark = await (await get('/api/badges/acme/open/card.svg?theme=dark')).text();
    expect(dark).toContain('#0d1117');
    expect(dark).not.toContain('prefers-color-scheme');
    expect(await (await get('/api/badges/acme/other/card.svg?theme=light')).text()).toContain('No description');
  });

  it('does not serve a card for a private or unknown repo', async () => {
    expect((await get('/api/badges/acme/secret/card.svg')).status).toBe(404);
    expect((await get('/api/badges/acme/nope/card.svg')).status).toBe(404);
  });

  it('summarizes the public repos only, archived ones included', async () => {
    const res = await get('/api/badges/summary.svg');
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('Open source at a glance: 2 public repos, 1.3k stars, 48.2k lines of code, 1.5k views (14d), 15.3k release downloads, – average health');
    expect(svg).not.toContain('5000');
  });

  it('takes a title for the summary and escapes it', async () => {
    const svg = await (await get('/api/badges/summary.svg?title=Acme%20%3Cscript%3E&theme=light')).text();
    expect(svg).toContain('>Acme &lt;script&gt;</text>');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('#ffffff');
  });

  it('serves no card or summary while badges are off', async () => {
    const off = { ...env, PUBLIC_BADGES: undefined };
    expect((await get('/api/badges/summary.svg', off)).status).toBe(404);
    expect((await get('/api/badges/acme/open/card.svg', off)).status).toBe(404);
  });

  it('tells signed-in clients what can be embedded', async () => {
    expect((await get('/api/embeds')).status).toBe(401);
    const res = await app.request('/api/embeds', { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
    expect(await res.json()).toEqual({
      badges: true, status: false,
      metrics: ['stars', 'loc', 'views', 'clones', 'health', 'coverage', 'ci', 'release', 'downloads'],
      themes: ['auto', 'light', 'dark'],
    });
  });
});

