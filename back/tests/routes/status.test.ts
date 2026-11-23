import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';

let env: any;
let storage: Storage;
const get = (path: string, config: any = env) => app.request(path, {}, config);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();

describe('public status', () => {
  beforeEach(async () => {
    ({ env, storage } = memoryEnv({ PUBLIC_STATUS: 'true' }));
    await storage.services.createService({ name: 'Web', slug: 'web', provider: 'vercel', url: 'https://internal.example/web', source_repo_full_name: 'acme/web' } as any);
    await storage.services.createService({ name: 'API', slug: 'api', provider: 'gcp', url: 'https://internal.example/api' });
    await storage.services.createService({ name: 'Old', slug: 'old', provider: 'gcp', url: 'https://internal.example/old' });
    await storage.services.updateService('old', { is_active: false });
    await storage.services.updateHealthCheck('web', 'healthy', 120, 200);
    await storage.services.updateHealthCheck('api', 'healthy', 80, 200);
    for (const [slug, status, hours] of [['api', 'healthy', 30], ['api', 'down', 29], ['api', 'healthy', 28], ['web', 'healthy', 5]] as const) {
      await storage.serviceChecks.recordCheck(slug, status, 100, status === 'down' ? 503 : 200, hoursAgo(hours));
    }
  });

  it('is off unless enabled, and needs no sign-in when on', async () => {
    expect((await get('/api/status', { ...env, PUBLIC_STATUS: undefined })).status).toBe(404);
    expect((await get('/api/status/badge.svg', { ...env, PUBLIC_STATUS: undefined })).status).toBe(404);
    expect((await get('/api/status')).status).toBe(200);
    // Nothing else under /api opens up with it.
    expect((await get('/api/status/other')).status).toBe(401);
    expect((await get('/api/services')).status).toBe(401);
  });

  it('lists the active services by name with their uptime history', async () => {
    const body = await (await get('/api/status')).json() as any;

    expect(body).toMatchObject({ overall: 'operational', days: 90 });
    expect(body.services.map((s: any) => s.name)).toEqual(['API', 'Web']);
    expect(body.services[0]).toMatchObject({ slug: 'api', status: 'healthy', uptimePct: 66.67, incidents: 1 });
    expect(body.services[0].daily).toHaveLength(90);
    expect(body.services[1]).toMatchObject({ slug: 'web', uptimePct: 100, incidents: 0, lastDownAt: null });
  });

  it('gives away nothing but names and status', async () => {
    const text = await (await get('/api/status')).text();
    expect(text).not.toContain('internal.example');
    expect(text).not.toContain('vercel');
    expect(text).not.toContain('acme/web');
    expect(text).not.toContain('Old');
  });

  it('reports the worst state as the overall one', async () => {
    await storage.services.updateHealthCheck('web', 'degraded', 6000, 200);
    expect((await (await get('/api/status')).json() as any).overall).toBe('degraded');
    await storage.services.updateHealthCheck('api', 'down', 0, 503);
    expect((await (await get('/api/status')).json() as any).overall).toBe('outage');
  });

  it('is unknown with no services or before any check', async () => {
    const empty = memoryEnv({ PUBLIC_STATUS: 'true' });
    expect(await (await get('/api/status', empty.env)).json()).toMatchObject({ overall: 'unknown', services: [] });
    await empty.storage.services.createService({ name: 'New', slug: 'new', provider: 'gcp', url: 'https://x.test' });
    expect((await (await get('/api/status', empty.env)).json() as any).overall).toBe('unknown');
  });

  it('serves the overall status and a service uptime as badges', async () => {
    const overall = await get('/api/status/badge.svg');
    expect(overall.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(await overall.text()).toContain('aria-label="status: operational"');

    expect(await (await get('/api/status/badge.svg?service=web')).text()).toContain('aria-label="Web uptime (90d): 100%"');
    expect(await (await get('/api/status/badge.svg?service=api')).text()).toContain('aria-label="API uptime (90d): 66.67%"');
    expect((await get('/api/status/badge.svg?service=old')).status).toBe(404);

    await storage.services.updateHealthCheck('api', 'down', 0, 503);
    expect(await (await get('/api/status/badge.svg')).text()).toContain('aria-label="status: outage"');
  });
});
