import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import worker from '@back/index';
import type { AppContext } from '@back/application/context';
import type { Storage } from '@back/application/ports/storage';
import { evaluateAlerts, sendDueDigests } from '@back/services/alert.service';

let env: any;
let storage: Storage;
let ctx: AppContext;
const fetcher = vi.fn();
const sent = () => fetcher.mock.calls.map(([url, init]) => ({ url, text: JSON.parse(init.body).text as string }));

const slack = (extra: Record<string, unknown> = {}) => storage.alertChannels.createChannel({
  name: 'Chat', type: 'slack', config: { url: 'https://hooks.test/chat' }, kinds: [], is_enabled: true, digest: 'off', ...extra,
} as any);
const setCi = (repo: string, status: string) =>
  storage.health.updateCiStatus(repo, { ci_status: status, ci_status_url: `https://ci.test/${repo}`, ci_status_run_at: null });
const securitySignal = (repo: string, critical: number, high: number) =>
  storage.signals.upsertSignal(repo, 'security', { bySeverity: { critical, high, medium: 0, low: 0 }, top: [{ title: 'lodash: prototype pollution' }] });

describe('alerts', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    fetcher.mockResolvedValue(new Response('ok'));
    ({ env, storage } = memoryEnv());
    ctx = { config: env, storage };
    await storage.repos.refreshFromGitHub([repoRecord('acme/api'), repoRecord('acme/web')]);
    await storage.services.createService({ name: 'API', slug: 'api', provider: 'gcp', url: 'https://api.test' });
  });

  describe('evaluation', () => {
    it('opens an alert when a condition appears and tells the channels once', async () => {
      await slack();
      await setCi('acme/api', 'failure');

      expect(await evaluateAlerts(ctx, { fetcher })).toEqual({ opened: 1, worsened: 0, resolved: 0, open: 1, delivered: 1, failed: 0 });
      expect(sent()).toEqual([{ url: 'https://hooks.test/chat', text: '🔴 CI is failing on acme/api\nhttps://ci.test/acme/api' }]);
      expect(await storage.alerts.listAlerts({ status: 'open' })).toEqual([
        expect.objectContaining({ key: 'ci_failing:acme/api', kind: 'ci_failing', entity: 'acme/api' }),
      ]);

      // Still failing: nothing new to say.
      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ opened: 0, open: 1, delivered: 0 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('resolves the alert when the condition goes away, and says so for CI and services', async () => {
      await slack();
      await setCi('acme/api', 'failure');
      await storage.services.updateHealthCheck('api', 'down', 0, 503);
      await evaluateAlerts(ctx, { fetcher });
      fetcher.mockClear();

      await setCi('acme/api', 'success');
      await storage.services.updateHealthCheck('api', 'healthy', 80, 200);
      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ resolved: 2, open: 0, delivered: 2 });

      expect(sent().map((m) => m.text.split('\n')[0]).sort()).toEqual([
        '🟢 Resolved: API is down', '🟢 Resolved: CI is failing on acme/api',
      ]);
      expect(await storage.alerts.listAlerts({ status: 'open' })).toEqual([]);
      expect(await storage.alerts.listAlerts({ status: 'resolved' })).toHaveLength(2);
    });

    it('opens a new alert when a resolved condition comes back', async () => {
      await setCi('acme/api', 'failure');
      await evaluateAlerts(ctx);
      await setCi('acme/api', 'success');
      await evaluateAlerts(ctx);
      await setCi('acme/api', 'failure');
      await evaluateAlerts(ctx);

      const all = await storage.alerts.listAlerts();
      expect(all.map((a) => a.status).sort()).toEqual(['open', 'resolved']);
    });

    it('speaks again when security alerts grow, and stays quiet when they shrink or close', async () => {
      await slack();
      await securitySignal('acme/api', 0, 1);
      await evaluateAlerts(ctx, { fetcher });
      await securitySignal('acme/api', 1, 1);
      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ opened: 0, worsened: 1, delivered: 1 });
      await securitySignal('acme/api', 1, 0);
      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ worsened: 0, delivered: 0 });
      await securitySignal('acme/api', 0, 0);
      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ resolved: 1, delivered: 0 });

      expect(sent().map((m) => m.text)).toEqual([
        '🔴 1 serious security alert on acme/api (1 high)\n• lodash: prototype pollution\nhttps://github.com/acme/api/security',
        '🔺 2 serious security alerts on acme/api (1 critical, 1 high)\n• lodash: prototype pollution\nhttps://github.com/acme/api/security',
      ]);
      const [alert] = await storage.alerts.listAlerts();
      expect(alert).toMatchObject({ status: 'resolved', title: '1 serious security alert on acme/api (1 critical)' });
    });

    it('sends each channel only the kinds it asked for, and skips disabled channels', async () => {
      await slack({ name: 'CI only', config: { url: 'https://hooks.test/ci' }, kinds: ['ci_failing'] });
      await slack({ name: 'Services', config: { url: 'https://hooks.test/services' }, kinds: ['service_down'] });
      await slack({ name: 'Off', config: { url: 'https://hooks.test/off' }, is_enabled: false });
      await setCi('acme/api', 'failure');

      await evaluateAlerts(ctx, { fetcher });

      expect(sent().map((m) => m.url)).toEqual(['https://hooks.test/ci']);
    });

    it('records what changed without telling anyone when asked not to notify', async () => {
      await slack();
      await setCi('acme/api', 'failure');

      expect(await evaluateAlerts(ctx, { notify: false, fetcher })).toMatchObject({ opened: 1, delivered: 0 });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await storage.alerts.listAlerts({ status: 'open' })).toHaveLength(1);
    });

    it('remembers why a delivery failed and clears it when one works', async () => {
      const { id } = await slack();
      await setCi('acme/api', 'failure');
      fetcher.mockResolvedValueOnce(new Response('gone', { status: 410 }));

      expect(await evaluateAlerts(ctx, { fetcher })).toMatchObject({ delivered: 0, failed: 1 });
      expect(await storage.alertChannels.getChannel(id)).toMatchObject({ last_error: 'The destination answered HTTP 410', last_sent_at: null });

      await setCi('acme/web', 'failure');
      await evaluateAlerts(ctx, { fetcher });
      const channel = await storage.alertChannels.getChannel(id);
      expect(channel!.last_error).toBeNull();
      expect(channel!.last_sent_at).not.toBeNull();
    });

    it('does not open the same alert twice when two evaluations overlap', async () => {
      await setCi('acme/api', 'failure');
      await Promise.all([evaluateAlerts(ctx), evaluateAlerts(ctx), evaluateAlerts(ctx)]);
      expect(await storage.alerts.listAlerts()).toHaveLength(1);
    });

    it('follows the configured thresholds', async () => {
      await storage.repos.refreshFromGitHub([
        repoRecord('acme/api', { last_commit_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }), repoRecord('acme/web'),
      ]);
      await storage.meta.patchRepoMeta('acme/api', { priority: 'high' });

      expect(await evaluateAlerts(ctx)).toMatchObject({ opened: 0 });
      expect(await evaluateAlerts({ config: { ...env, ALERT_STALE_DAYS: '30' }, storage })).toMatchObject({ opened: 1 });
    });
  });

  describe('running on its own', () => {
    it('is evaluated after the scheduled service checks', async () => {
      await slack();
      vi.stubGlobal('fetch', vi.fn(async (url: string) => (
        url === 'https://api.test' ? new Response('boom', { status: 503 }) : new Response('ok')
      )));
      try {
        const { runScheduledChecks } = await import('@back/services/service-check.service');
        await runScheduledChecks(ctx);
        expect(await storage.alerts.listAlerts({ status: 'open' })).toEqual([
          expect.objectContaining({ key: 'service_down:api', title: 'API is down' }),
        ]);
        expect(vi.mocked(fetch)).toHaveBeenCalledWith('https://hooks.test/chat', expect.anything());
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('digests', () => {
    const at = (iso: string) => new Date(iso);

    it('sends a summary when the period has passed, then waits for the next one', async () => {
      const { id } = await slack({ digest: 'daily' });
      await setCi('acme/api', 'failure');
      await securitySignal('acme/web', 2, 0);
      await evaluateAlerts(ctx, { notify: false });
      const created = new Date((await storage.alertChannels.getChannel(id))!.created_at).getTime();

      expect(await sendDueDigests(ctx, { fetcher, now: at(new Date(created + 3_600_000).toISOString()) })).toBe(0);
      expect(await sendDueDigests(ctx, { fetcher, now: at(new Date(created + 24 * 3_600_000).toISOString()) })).toBe(1);

      expect(sent()[0].text).toBe([
        '📋 GitHub Control digest: 2 open alerts',
        'In the last day: 2 opened, 0 resolved.',
        '• [Security alerts] 2 serious security alerts on acme/web (2 critical)',
        '• [CI failing] CI is failing on acme/api',
      ].join('\n'));
      expect((await storage.alertChannels.getChannel(id))!.last_digest_at).not.toBeNull();

      // Marked as sent just now: not due again for another day.
      expect(await sendDueDigests(ctx, { fetcher })).toBe(0);
    });

    it('covers only the kinds of the channel and says when all is clear', async () => {
      await slack({ digest: 'weekly', kinds: ['service_down'] });
      await setCi('acme/api', 'failure');
      await evaluateAlerts(ctx, { notify: false });

      const now = at(new Date(Date.now() + 8 * 86_400_000).toISOString());
      expect(await sendDueDigests(ctx, { fetcher, now })).toBe(1);
      expect(sent()[0].text).toBe('🟢 GitHub Control digest: no open alerts\nIn the last week: 0 opened, 0 resolved.');
    });

    it('skips channels without a digest and disabled ones', async () => {
      await slack();
      await slack({ digest: 'daily', is_enabled: false });
      const now = at(new Date(Date.now() + 30 * 86_400_000).toISOString());
      expect(await sendDueDigests(ctx, { fetcher, now })).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe('API', () => {
    const request = (path: string, init: RequestInit = {}) => worker.request(path, {
      ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json' },
    }, env);
    const post = (path: string, body?: unknown, method = 'POST') =>
      request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

    beforeEach(() => vi.stubGlobal('fetch', fetcher));
    afterEach(() => vi.unstubAllGlobals());

    it('lists open alerts by default and the history on request', async () => {
      await setCi('acme/api', 'failure');
      await setCi('acme/web', 'failure');
      await evaluateAlerts(ctx);
      await setCi('acme/web', 'success');
      await evaluateAlerts(ctx);

      const open = await (await request('/api/alerts')).json() as any;
      expect(open.alerts.map((a: any) => a.key)).toEqual(['ci_failing:acme/api']);
      expect(open).toMatchObject({ open: 1, rules: { staleDays: 90, healthBelow: 40 }, kinds: { ci_failing: 'CI failing' } });

      const all = await (await request('/api/alerts?status=all')).json() as any;
      expect(all.alerts).toHaveLength(2);
      expect(all.open).toBe(1);
      expect((await (await request('/api/alerts?status=resolved')).json() as any).alerts).toHaveLength(1);
      expect((await request('/api/alerts?status=nope')).status).toBe(400);

      // A short page still reports how many are open in total.
      await setCi('acme/web', 'failure');
      await evaluateAlerts(ctx);
      const page = await (await request('/api/alerts?limit=1')).json() as any;
      expect(page.alerts).toHaveLength(1);
      expect(page.open).toBe(2);
    });

    it('evaluates on demand', async () => {
      await setCi('acme/api', 'failure');
      expect(await (await post('/api/alerts/evaluate')).json()).toMatchObject({ opened: 1, open: 1 });
    });

    it('creates a channel without ever returning its secret', async () => {
      const res = await post('/api/alerts/channels', {
        name: ' Team chat ', type: 'slack', config: { url: 'https://hooks.slack.com/services/T1/B2/secret99' }, kinds: ['ci_failing'], digest: 'daily',
      });
      expect(res.status).toBe(201);
      const { channel } = await res.json() as any;
      expect(channel).toMatchObject({
        name: 'Team chat', type: 'slack', config: { url: '••••et99' }, kinds: ['ci_failing'], is_enabled: true, digest: 'daily',
      });

      const listed = await (await request('/api/alerts/channels')).json() as any;
      expect(JSON.stringify(listed)).not.toContain('secret99');
      expect(listed.types.map((t: any) => t.type)).toEqual(['webhook', 'slack', 'discord', 'telegram', 'ntfy']);
      expect(listed.kinds).toContainEqual({ kind: 'service_down', label: 'Service down' });
      expect((await storage.alertChannels.getChannel(channel.id))!.config.url).toBe('https://hooks.slack.com/services/T1/B2/secret99');
    });

    it('does not tell a new channel about what was already wrong', async () => {
      await setCi('acme/api', 'failure');
      await post('/api/alerts/channels', { name: 'Chat', type: 'slack', config: { url: 'https://hooks.test/chat' } });

      expect(await storage.alerts.listAlerts({ status: 'open' })).toHaveLength(1);
      await evaluateAlerts(ctx);
      expect(fetcher).not.toHaveBeenCalled();

      await setCi('acme/web', 'failure');
      await evaluateAlerts(ctx);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown type, a bad destination and a malformed body', async () => {
      expect((await post('/api/alerts/channels', { name: 'X', type: 'pager', config: {} })).status).toBe(400);
      expect((await post('/api/alerts/channels', { name: 'X', type: 'slack', config: { url: 'nope' } })).status).toBe(400);
      expect((await post('/api/alerts/channels', { name: '', type: 'slack', config: { url: 'https://a.test' } })).status).toBe(400);
      expect((await post('/api/alerts/channels', { name: 'X', type: 'slack', config: { url: 'https://a.test' }, kinds: ['nope'] })).status).toBe(400);
      expect((await request('/api/alerts/channels', { method: 'POST', body: '{' })).status).toBe(400);
      expect(await storage.alertChannels.listChannels()).toEqual([]);
    });

    it('edits a channel keeping the secret that was not sent again', async () => {
      const { id } = await slack({ type: 'telegram', config: { botToken: '123:abc', chatId: '-100' } });

      const res = await post(`/api/alerts/channels/${id}`, {
        name: 'Renamed', type: 'telegram', config: { botToken: '', chatId: '-200' }, is_enabled: false, digest: 'weekly',
      }, 'PUT');
      expect(res.status).toBe(200);
      expect(await storage.alertChannels.getChannel(id)).toMatchObject({
        name: 'Renamed', config: { botToken: '123:abc', chatId: '-200' }, is_enabled: false, digest: 'weekly', kinds: [],
      });

      // Another type does not inherit the old secret.
      expect((await post(`/api/alerts/channels/${id}`, { name: 'Renamed', type: 'slack', config: { url: '' } }, 'PUT')).status).toBe(400);
      expect((await post('/api/alerts/channels/999', { name: 'X', type: 'slack', config: { url: 'https://a.test' } }, 'PUT')).status).toBe(404);
      expect((await post('/api/alerts/channels/abc', { name: 'X', type: 'slack', config: {} }, 'PUT')).status).toBe(400);
    });

    it('sends a test message and reports how it went', async () => {
      const { id } = await slack();

      expect(await (await post(`/api/alerts/channels/${id}/test`)).json()).toEqual({ ok: true, error: null });
      expect(JSON.parse(fetcher.mock.calls[0][1].body).text).toContain('test message');

      fetcher.mockResolvedValueOnce(new Response('no', { status: 403 }));
      expect(await (await post(`/api/alerts/channels/${id}/test`)).json()).toEqual({ ok: false, error: 'The destination answered HTTP 403' });
      expect((await storage.alertChannels.getChannel(id))!.last_error).toBe('The destination answered HTTP 403');
      expect((await post('/api/alerts/channels/999/test')).status).toBe(404);
    });

    it('deletes a channel', async () => {
      const { id } = await slack();
      expect((await post(`/api/alerts/channels/${id}`, undefined, 'DELETE')).status).toBe(200);
      expect((await post(`/api/alerts/channels/${id}`, undefined, 'DELETE')).status).toBe(404);
      expect(await storage.alertChannels.listChannels()).toEqual([]);
    });

    it('requires authentication', async () => {
      expect((await worker.request('/api/alerts', {}, env)).status).toBe(401);
      expect((await worker.request('/api/alerts/channels', {}, env)).status).toBe(401);
    });
  });
});
