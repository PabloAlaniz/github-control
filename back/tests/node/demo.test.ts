import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createServerApp, serviceCheckMinutes } from '@back/node/server-app';
import { demoMode, demoResetMinutes } from '@back/node/demo';
import { demoAllows } from '@back/middleware/demo';

const DEMO_DATA = resolve(__dirname, '../../../docs/demo/demo-data.json');

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghc-demo-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
afterEach(() => vi.useRealTimers());

function start(env: Record<string, string>, demoDataPath: string | undefined = DEMO_DATA) {
  const logs: string[] = [];
  const dataDir = tempDir();
  const app = createServerApp({ env, dataDir, demoDataPath, autoSync: true, log: (m) => logs.push(m) });
  const send = (method: string, path: string, body?: unknown) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { app, logs, dataDir, send };
}

describe('demo mode: environment', () => {
  it('is on only for DEMO=true or DEMO=readonly', () => {
    expect(demoMode({})).toBeNull();
    expect(demoMode({ DEMO: 'false' })).toBeNull();
    expect(demoMode({ DEMO: ' TRUE ' })).toBe('true');
    expect(demoMode({ DEMO: 'readonly' })).toBe('readonly');
  });

  it('reloads every hour unless told otherwise', () => {
    expect(demoResetMinutes({})).toBe(60);
    expect(demoResetMinutes({ DEMO_RESET_MINUTES: '10' })).toBe(10);
    expect(demoResetMinutes({ DEMO_RESET_MINUTES: '0' })).toBe(0);
    expect(demoResetMinutes({ DEMO_RESET_MINUTES: 'soon' })).toBe(60);
  });
});

describe('service check interval', () => {
  it('is 15 minutes unless a whole number of minutes up to a day is configured', () => {
    expect(serviceCheckMinutes(undefined)).toBe(15);
    expect(serviceCheckMinutes('5')).toBe(5);
    expect(serviceCheckMinutes(' 1 ')).toBe(1);
    expect(serviceCheckMinutes('0')).toBe(15);
    expect(serviceCheckMinutes('2.5')).toBe(15);
    expect(serviceCheckMinutes('5000')).toBe(15);
    expect(serviceCheckMinutes('often')).toBe(15);
  });
});

describe('demo mode: what it allows', () => {
  it('lets an editable demo change local data only', () => {
    expect(demoAllows('true', 'GET', '/api/repos')).toBe(true);
    expect(demoAllows('true', 'PATCH', '/api/meta/acme/api')).toBe(true);
    expect(demoAllows('true', 'POST', '/api/groups')).toBe(true);
    expect(demoAllows('true', 'DELETE', '/api/saved-views/3')).toBe(true);
    expect(demoAllows('true', 'POST', '/api/repos/acme/api/priority')).toBe(true);

    expect(demoAllows('true', 'POST', '/api/sync')).toBe(false);
    expect(demoAllows('true', 'POST', '/api/repos/acme/api/archive')).toBe(false);
    expect(demoAllows('true', 'POST', '/api/repos/acme/api/branches/delete')).toBe(false);
    expect(demoAllows('true', 'POST', '/api/repos/acme/api/config/apply')).toBe(false);
    expect(demoAllows('true', 'POST', '/api/services/storefront/health-check')).toBe(false);
    expect(demoAllows('true', 'POST', '/api/import')).toBe(false);
    expect(demoAllows('true', 'PATCH', '/api/settings')).toBe(false);
  });

  it('lets a read-only demo change nothing', () => {
    expect(demoAllows('readonly', 'GET', '/api/repos')).toBe(true);
    expect(demoAllows('readonly', 'PATCH', '/api/meta/acme/api')).toBe(false);
    expect(demoAllows('readonly', 'POST', '/api/groups')).toBe(false);
  });

  it('refuses the reads that would call GitHub', () => {
    expect(demoAllows('true', 'GET', '/api/user')).toBe(false);
    expect(demoAllows('true', 'GET', '/api/prs')).toBe(false);
    expect(demoAllows('true', 'GET', '/api/repos/acme/api/readme')).toBe(false);
    expect(demoAllows('true', 'GET', '/api/repos/acme/api/signals')).toBe(true);
  });
});

describe('demo mode: server', () => {
  it('serves the dataset with no setup, no sign-in and nothing on disk', async () => {
    const { send, logs, dataDir } = start({ DEMO: 'true' });

    expect(logs.join('\n')).toMatch(/Demo mode \(editable\)/);
    expect(logs.join('\n')).not.toMatch(/setup code/i);

    const status = await (await send('GET', '/api/setup/status')).json();
    expect(status).toEqual({ configured: true, authRequired: false, demo: { readOnly: false, resetMinutes: 60 } });

    const repos = await (await send('GET', '/api/repos')).json();
    expect(repos.length).toBeGreaterThan(5);
    expect(repos.every((repo: any) => repo.owner === 'acme')).toBe(true);

    expect(existsSync(dataDir) ? readdirSync(dataDir) : []).toEqual([]);
  });

  it('moves the dataset so that it ends today', async () => {
    const { send } = start({ DEMO: 'true' });
    const repos = await (await send('GET', '/api/repos')).json();
    const newest = Math.max(...repos.map((repo: any) => new Date(repo.last_commit_at).getTime()));
    expect(Date.now() - newest).toBeLessThan(4 * 86_400_000);
  });

  it('includes signals, dependencies and uptime history', async () => {
    const { send } = start({ DEMO: 'true' });

    const { signals } = await (await send('GET', '/api/repos/acme/billing-worker/signals')).json();
    expect(Object.keys(signals).sort()).toEqual(['branches', 'ci', 'config', 'dependencies', 'inbox', 'release', 'security', 'standards']);

    const inventory = await (await send('GET', '/api/dependencies')).json();
    expect(inventory.packages.length).toBeGreaterThan(10);
    expect(inventory.runtimes.some((runtime: any) => runtime.eol)).toBe(true);

    const uptime = await (await send('GET', '/api/services/uptime')).json();
    expect(uptime.services.storefront.checks).toBeGreaterThan(100);
  });

  it('derives its alerts from the dataset, with no channel to tell', async () => {
    const { send } = start({ DEMO: 'true' });

    const { alerts, open } = await (await send('GET', '/api/alerts')).json();
    expect(open).toBeGreaterThan(2);
    expect(alerts.map((alert: any) => alert.key)).toContain('ci_failing:acme/billing-worker');
    expect((await (await send('GET', '/api/alerts/channels')).json()).channels).toEqual([]);

    // A channel would make the server call a URL of the visitor's choosing.
    const refused = await send('POST', '/api/alerts/channels', { name: 'x', type: 'webhook', config: { url: 'https://example.com' } });
    expect(refused.status).toBe(403);
  });

  it('has an inbox seen as its fictional viewer, which cannot be refreshed or merged', async () => {
    const { send } = start({ DEMO: 'true' });

    const inbox = await (await send('GET', '/api/inbox')).json();
    expect(inbox.viewer).toBe('alice');
    expect(inbox.items.length).toBeGreaterThan(20);
    expect(inbox.items.some((item: any) => item.requestedReviewers.includes('alice'))).toBe(true);
    expect(inbox.items.some((item: any) => item.authorIsBot && item.type === 'pr')).toBe(true);

    expect((await send('POST', '/api/inbox/refresh')).status).toBe(403);
    expect((await send('POST', '/api/inbox/merge', { pulls: [] })).status).toBe(403);
  });

  it('shows the public surfaces: cards, badges and the status page', async () => {
    const { send } = start({ DEMO: 'true' });

    const summary = await send('GET', '/api/badges/summary.svg');
    expect(summary.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(await summary.text()).toMatch(/\d+ public repos/);
    expect(await (await send('GET', '/api/badges/acme/cli-tools/downloads.svg')).text()).toContain('downloads: 18.4k');
    expect((await send('GET', '/api/badges/acme/checkout-api/card.svg')).status).toBe(404);   // private

    const status = await (await send('GET', '/api/status')).json();
    expect(status.services.map((service: any) => service.name)).toEqual(['Checkout API', 'Docs', 'Storefront']);
    expect(await (await send('GET', '/api/embeds')).json()).toMatchObject({ badges: true, status: true });
  });

  it('accepts local edits and refuses what needs GitHub', async () => {
    const { send } = start({ DEMO: 'true' });

    expect((await send('POST', '/api/repos/acme/docs-site/priority', { priority: 'high' })).status).toBe(200);
    const repo = await (await send('GET', '/api/repos/acme/docs-site')).json();
    expect(repo.priority).toBe('high');

    const refused = await send('POST', '/api/sync');
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ demo: true });
  });

  it('refuses every write when read-only', async () => {
    const { send, logs } = start({ DEMO: 'readonly' });
    expect(logs.join('\n')).toMatch(/Demo mode \(read-only\)/);

    const status = await (await send('GET', '/api/setup/status')).json();
    expect(status.demo.readOnly).toBe(true);
    expect((await send('POST', '/api/repos/acme/docs-site/priority', { priority: 'high' })).status).toBe(403);
    expect((await send('GET', '/api/repos')).status).toBe(200);
  });

  it('discards the visitors\' changes when it reloads', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { send } = start({ DEMO: 'true', DEMO_RESET_MINUTES: '5' });
    const before = (await (await send('GET', '/api/repos/acme/docs-site')).json()).priority;

    await send('POST', '/api/repos/acme/docs-site/priority', { priority: before === 'high' ? 'low' : 'high' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    const after = (await (await send('GET', '/api/repos/acme/docs-site')).json()).priority;
    expect(after).toBe(before);
  });

  it('says what is wrong when the dataset is missing or not an export', () => {
    expect(() => start({ DEMO: 'true' }, join(tempDir(), 'nope.json'))).toThrow(/could not be read.*DEMO_DATA/);

    const notAnExport = join(tempDir(), 'other.json');
    writeFileSync(notAnExport, '{"hello":"world"}');
    expect(() => start({ DEMO: 'true' }, notAnExport)).toThrow(/not a GitHub Control export/);
  });

  it('leaves a normal server untouched', async () => {
    const { send, logs } = start({});
    expect(logs.join('\n')).toMatch(/Setup required/);
    const status = await (await send('GET', '/api/setup/status')).json();
    expect(status.configured).toBe(false);
    expect(status.demo).toBeUndefined();
  });
});
