import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { highlights, type Report } from '@back/services/report.service';

let env: any;
let storage: Storage;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const get = async (path: string) => {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
  return { status: res.status, body: await res.json() as any };
};
const pr = (number: number, extra: Record<string, unknown> = {}) => ({
  type: 'pr', number, title: `PR ${number}`, draft: false, createdAt: daysAgo(2), updatedAt: daysAgo(1), checks: null, review: null, ...extra,
});

describe('GET /api/report', () => {
  beforeEach(async () => {
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([
      repoRecord('acme/api', { repo_created_at: daysAgo(400) }), repoRecord('acme/new', { repo_created_at: daysAgo(3) }),
      repoRecord('acme/old', { is_archived: true }),
    ]);
  });

  it('is quiet when nothing happened', async () => {
    const empty = memoryEnv();
    const res = await app.request('/api/report', { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, empty.env);
    const body = await res.json() as any;
    expect(body).toMatchObject({
      days: 7, highlights: ['A quiet stretch: nothing notable this week.'],
      repos: { total: 0, added: [] }, growth: { stars: 0, loc: 0 }, releases: [],
      alerts: { opened: 0, resolved: 0, open: [] }, ci: { failing: [] }, services: [],
    });
  });

  it('gathers what changed in the period from stored data', async () => {
    await storage.health.updateCiStatus('acme/api', { ci_status: 'failure', ci_status_url: null, ci_status_run_at: null });
    await storage.signals.upsertSignal('acme/api', 'release', { hasRelease: true, tag: 'v2.0.0', publishedAt: daysAgo(2), url: 'https://x/r' });
    await storage.signals.upsertSignal('acme/new', 'release', { hasRelease: true, tag: 'v0.1.0', publishedAt: daysAgo(30) });
    await storage.signals.upsertSignal('acme/old', 'release', { hasRelease: true, tag: 'v9', publishedAt: daysAgo(1) });
    await storage.signals.upsertSignal('acme/api', 'inbox', { items: [
      pr(1, { checks: 'success', review: 'approved' }), pr(2, { createdAt: daysAgo(20) }),
      { type: 'issue', number: 3, createdAt: daysAgo(1) }, { type: 'issue', number: 4, createdAt: daysAgo(90) },
    ] });
    const alert = await storage.alerts.openAlert({ key: 'service_down:web', kind: 'service_down', entity: 'web', title: 'Web is down', detail: {}, url: null, level: 0 });
    await storage.alerts.resolveAlert(alert.id);
    await storage.alerts.openAlert({ key: 'ci_failing:acme/api', kind: 'ci_failing', entity: 'acme/api', title: 'CI is failing on acme/api', detail: {}, url: null, level: 0 });
    await storage.services.createService({ name: 'Web', slug: 'web', provider: 'x', url: 'https://web.test' });
    for (const [status, hours] of [['healthy', 30], ['down', 29], ['healthy', 28]] as const) {
      await storage.serviceChecks.recordCheck('web', status, 10, 200, new Date(Date.now() - hours * 3_600_000).toISOString());
    }
    const day = (n: number) => daysAgo(n).slice(0, 10);
    await storage.traffic.upsertDaily('acme/api', [
      { day: day(1), views: 300, views_unique: 1, clones: 12, clones_unique: 1 },
      { day: day(10), views: 100, views_unique: 1, clones: 5, clones_unique: 1 },
    ]);

    const { body } = await get('/api/report');
    expect(body.repos).toEqual({ total: 2, added: [expect.objectContaining({ repo: 'acme/new' })] });
    expect(body.releases).toEqual([{ repo: 'acme/api', tag: 'v2.0.0', publishedAt: expect.any(String), url: 'https://x/r' }]);
    expect(body.alerts).toMatchObject({ opened: 2, resolved: 1, open: [{ kind: 'ci_failing', title: 'CI is failing on acme/api' }] });
    expect(body.inbox).toEqual({ openPrs: 2, openIssues: 2, prsOpened: 1, issuesOpened: 1, readyToMerge: 1 });
    expect(body.ci.failing).toEqual(['acme/api']);
    expect(body.services).toEqual([{ name: 'Web', uptimePct: 66.67, incidents: 1 }]);
    expect(body.traffic).toEqual({ views: 300, previousViews: 100, clones: 12 });

    expect(body.highlights).toEqual([
      'CI is failing on acme/api.',
      'Web (1 incident) went down this week.',
      '2 alerts opened and 1 resolved this week; 1 still open.',
      '1 release published: acme/api v2.0.0.',
      '1 pull request is ready to merge.',
      '1 pull request and 1 issue opened this week are still open.',
      'Views are up 200% on the period before.',
      '1 new repo: acme/new.',
    ]);
  });

  it('covers the number of days asked for, within limits', async () => {
    await storage.signals.upsertSignal('acme/api', 'release', { hasRelease: true, tag: 'v1', publishedAt: daysAgo(20) });
    expect((await get('/api/report?days=7')).body.releases).toEqual([]);
    const month = (await get('/api/report?days=30')).body;
    expect(month.days).toBe(30);
    expect(month.releases).toHaveLength(1);
    expect(month.highlights[0]).toBe('1 release published: acme/api v1.');
    expect((await get('/api/report?days=500')).body.days).toBe(7);
    expect((await get('/api/report?days=x')).body.days).toBe(7);
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/report', {}, env)).status).toBe(401);
  });
});

describe('report highlights', () => {
  const base: Report = {
    days: 7, from: '', to: '', highlights: [], repos: { total: 5, added: [] },
    growth: { stars: 0, loc: 0, topStars: [], topLoc: [] }, releases: [],
    alerts: { opened: 0, resolved: 0, open: [] }, inbox: { openPrs: 0, openIssues: 0, prsOpened: 0, issuesOpened: 0, readyToMerge: 0 },
    ci: { failing: [] }, services: [], traffic: { views: 0, previousViews: 0, clones: 0 },
  };

  it('mentions star growth either way and wording for other periods', () => {
    expect(highlights({ ...base, growth: { ...base.growth, stars: 12 } })).toEqual(['+12 stars this week.']);
    expect(highlights({ ...base, days: 30, growth: { ...base.growth, stars: -3 } })).toEqual(['-3 stars in the last 30 days.']);
  });

  it('shortens a long list of failing repos and ignores small traffic changes', () => {
    const failing = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'];
    expect(highlights({ ...base, ci: { failing }, traffic: { views: 105, previousViews: 100, clones: 0 } })).toEqual(['CI is failing on a/1, a/2, a/3 and 2 more.']);
    expect(highlights({ ...base, traffic: { views: 40, previousViews: 100, clones: 0 } })).toEqual(['Views are down 60% on the period before.']);
  });
});
