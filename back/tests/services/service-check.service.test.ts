import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { memoryEnv, mockEnv } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import worker from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { probe, runScheduledChecks, buildUptime, HISTORY_DAYS } from '@back/services/service-check.service';

let env: any;
let storage: Storage;
const mockFetch = vi.fn();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const request = (path: string, init: RequestInit = {}) =>
  worker.request(path, { ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);

describe('service checks', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    ({ env, storage } = memoryEnv());
    await storage.services.createService({ name: 'API', slug: 'api', provider: 'gcp', url: 'https://api.test' });
    await storage.services.createService({ name: 'Web', slug: 'web', provider: 'gcp', url: 'https://web.test' });
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('probe', () => {
    it.each([
      [200, 'healthy'], [204, 'healthy'], [301, 'degraded'], [404, 'degraded'], [500, 'down'], [503, 'down'],
    ])('classifies HTTP %i as %s', async (code, status) => {
      mockFetch.mockResolvedValue({ status: code });
      expect(await probe('https://x.test')).toMatchObject({ status, httpCode: code });
    });

    it('treats a slow 2xx as degraded', async () => {
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(6000);
      mockFetch.mockResolvedValue({ status: 200 });
      expect(await probe('https://x.test')).toEqual({ status: 'degraded', httpCode: 200, responseMs: 6000 });
      nowSpy.mockRestore();
    });

    it('treats a network error as down', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await probe('https://x.test')).toMatchObject({ status: 'down', httpCode: null });
    });
  });

  describe('scheduled run', () => {
    it('checks every active service, records history and prunes old checks', async () => {
      await storage.serviceChecks.recordCheck('api', 'healthy', 10, 200, daysAgo(HISTORY_DAYS + 5));
      mockFetch.mockImplementation(async (url: string) => ({ status: url.includes('api') ? 200 : 502 }));

      const summary = await runScheduledChecks({ config: env, storage });

      expect(summary).toMatchObject({ total: 2, healthy: 1, degraded: 0, down: 1 });
      expect((await storage.services.getService('web'))!.last_check_status).toBe('down');
      const history = await storage.serviceChecks.getDailyUptime(365);
      expect(history.map(d => [d.slug, d.checks, d.down])).toEqual([['api', 1, 0], ['web', 1, 1]]);
    });

    it('counts a service whose check cannot be stored as down', async () => {
      mockFetch.mockResolvedValue({ status: 200 });
      vi.spyOn(storage.services, 'updateHealthCheck').mockRejectedValueOnce(new Error('disk full'));

      const summary = await runScheduledChecks({ config: env, storage });

      expect(summary).toMatchObject({ total: 2, healthy: 1, down: 1 });
      expect(summary.results).toContainEqual({ slug: 'unknown', status: 'down', error: 'disk full' });
    });

    it('is wired as the Worker cron handler', async () => {
      mockFetch.mockResolvedValue({ status: 200 });
      const waitUntil = vi.fn();

      await (worker as any).scheduled({}, env, { waitUntil });

      await expect(waitUntil.mock.calls[0][0]).resolves.toMatchObject({ total: 2, healthy: 2 });
      expect(typeof (worker as any).fetch).toBe('function');
    });
  });

  describe('routes', () => {
    it('a manual check is added to the history', async () => {
      mockFetch.mockResolvedValue({ status: 404 });

      const body = await (await request('/api/services/api/health-check', { method: 'POST' })).json();

      expect(body.status).toBe('degraded');
      expect(await storage.serviceChecks.getDailyUptime(1)).toEqual([
        expect.objectContaining({ slug: 'api', checks: 1, down: 0, degraded: 1 }),
      ]);
    });

    it('GET /api/services/uptime summarizes uptime, latency and incidents', async () => {
      for (const [status, ms] of [['healthy', 100], ['down', null], ['down', null], ['healthy', 200]] as const) {
        await storage.serviceChecks.recordCheck('api', status, ms, ms ? 200 : null);
      }
      await storage.serviceChecks.recordCheck('web', 'healthy', null, 200, daysAgo(3));

      const res = await request('/api/services/uptime?days=7');
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.days).toBe(7);
      expect(body.services.api).toMatchObject({ checks: 4, uptimePct: 50, avgMs: 150, incidents: 1, lastDownAt: expect.any(String) });
      expect(body.services.api.daily).toHaveLength(7);
      expect(body.services.api.daily.at(-1)).toMatchObject({ checks: 4, down: 2 });
      expect(body.services.api.daily[0]).toMatchObject({ checks: 0, avgMs: null });
      expect(body.services.web).toMatchObject({ uptimePct: 100, avgMs: null, incidents: 0, lastDownAt: null });
    });

    it.each([['abc'], ['0'], ['400'], ['1.5']])('falls back to 30 days for days=%s', async (days) => {
      expect(await (await request(`/api/services/uptime?days=${days}`)).json()).toEqual({ days: 30, services: {} });
    });

    it('"uptime" is not mistaken for a service slug', async () => {
      const res = await request('/api/services/uptime');
      expect(res.status).toBe(200);
      expect((await res.json()).days).toBe(30);
    });
  });

  describe('buildUptime', () => {
    it('returns no services without history', () => {
      expect(buildUptime([], [], 30)).toEqual({ days: 30, services: {} });
    });

    it('fills missing days with empty entries, oldest first', () => {
      const now = new Date('2026-11-23T12:00:00Z');
      const result: any = buildUptime(
        [{ slug: 'api', day: '2026-11-22', checks: 10, down: 5, degraded: 0, avg_ms: 250 }],
        [], 3, now,
      );
      expect(result.services.api.daily.map((d: any) => d.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
      expect(result.services.api.daily.map((d: any) => d.checks)).toEqual([0, 10, 0]);
      expect(result.services.api.uptimePct).toBe(50);
    });
  });
});
