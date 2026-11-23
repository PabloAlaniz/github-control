import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRepos = vi.fn();
const mockSyncRepoHealth = vi.fn();
const mockLatestRun = vi.fn();

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: (...args: any[]) => mockGetRepos(...args),
}));
vi.mock('@back/services/health-sync.service', () => ({
  syncRepoHealth: (...args: any[]) => mockSyncRepoHealth(...args),
}));
const mockTraffic = vi.fn();
vi.mock('@back/services/traffic.service', () => ({
  syncRepoTraffic: (...args: any[]) => mockTraffic(...args),
}));
const mockSignals = vi.fn();
vi.mock('@back/services/signal.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@back/services/signal.service')>()),
  syncSignals: (...args: any[]) => mockSignals(...args),
}));
vi.mock('@back/lib/github/workflows', () => ({
  getLatestWorkflowRun: (...args: any[]) => mockLatestRun(...args),
  deriveCiStatus: (run: any) => (run ? run.conclusion : null),
}));

import app from '@back/index';
import { createMemoryStorage } from '@back/infrastructure/storage/memory';
import { createStorage } from '@back/infrastructure/storage';
import {
  getSyncStatus, isSyncDue, runFullSync, startFullSync,
} from '@back/services/full-sync.service';
import { mockEnv } from '../helpers';

const gh = (name: string, extra: Record<string, unknown> = {}) => ({
  full_name: `acme/${name}`, owner: 'acme', name, is_private: false, is_archived: false, ...extra,
});
const context = () => ({ config: { ...mockEnv } as any, storage: createMemoryStorage() });

describe('full sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepos.mockResolvedValue([gh('a'), gh('b'), gh('archived', { is_archived: true })]);
    mockSyncRepoHealth.mockResolvedValue({});
    mockSignals.mockResolvedValue([]);
    mockTraffic.mockResolvedValue(true);
    mockLatestRun.mockResolvedValue({ conclusion: 'success', html_url: 'https://ci/1', run_at: '2026-01-02T03:04:05Z' });
  });

  it('refreshes the list, then syncs health and CI status of every active repo', async () => {
    const ctx = context();
    const progress: string[] = [];
    const summary = await runFullSync(ctx, { trigger: 'schedule', onProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`) });

    expect(summary).toMatchObject({
      trigger: 'schedule', repos: { total: 2, synced: 2, failed: 0, removed: 0 }, errors: [],
    });
    expect(summary.error).toBeUndefined();
    expect(mockSyncRepoHealth.mock.calls.map((c) => `${c[1]}/${c[2]}`).sort()).toEqual(['acme/a', 'acme/b']);
    expect(mockSyncRepoHealth.mock.calls[0][3]).toEqual({ type: 'system', name: 'schedule_sync' });
    expect(await ctx.storage.repos.getRepo('acme/a')).toMatchObject({
      ci_status: 'success', ci_status_url: 'https://ci/1', ci_status_run_at: '2026-01-02T03:04:05.000Z',
    });
    expect(mockTraffic.mock.calls.map((c) => `${c[1]}/${c[2]}`).sort()).toEqual(['acme/a', 'acme/b']);
    expect(progress[0]).toBe('refreshing:0/0');
    expect(progress.at(-1)).toBe('syncing:2/2');

    const [entry] = await ctx.storage.activity.listActivities({ limit: 5, offset: 0, action: 'sync.full' });
    expect(entry).toMatchObject({ actor_name: 'schedule_sync', new_value: 'Synced 2/2 repos (0 failed)' });
  });

  it('keeps going when a repo fails and reports it', async () => {
    mockSyncRepoHealth.mockImplementation(async (_ctx: unknown, _owner: string, repo: string) => {
      if (repo === 'a') throw new Error('rate limited');
      return {};
    });
    const summary = await runFullSync(context());

    expect(summary.repos).toMatchObject({ total: 2, synced: 1, failed: 1 });
    expect(summary.errors).toEqual([{ repo: 'acme/a', error: 'rate limited' }]);
  });

  it('does not fail a repo when its traffic cannot be read', async () => {
    mockTraffic.mockRejectedValue(new Error('secondary rate limit'));
    const summary = await runFullSync(context());
    expect(summary.repos).toMatchObject({ synced: 2, failed: 0 });
  });

  it('refreshes the signals of every repo, without failing a repo when they cannot be read', async () => {
    mockSignals.mockRejectedValueOnce(new Error('forbidden')).mockResolvedValue([]);
    const ctx = context();
    const summary = await runFullSync(ctx);

    expect(mockSignals.mock.calls.map(call => `${call[1]}/${call[2]}`).sort()).toEqual(['acme/a', 'acme/b']);
    expect(mockSignals.mock.calls[0][0]).toBe(ctx);
    expect(summary.repos).toMatchObject({ synced: 2, failed: 0 });
  });

  it('reports a failed refresh without throwing', async () => {
    mockGetRepos.mockRejectedValue(new Error('Bad credentials'));
    const ctx = context();
    const summary = await runFullSync(ctx);

    expect(summary.error).toBe('Bad credentials');
    expect(summary.repos.total).toBe(0);
    expect(mockSyncRepoHealth).not.toHaveBeenCalled();
    const [entry] = await ctx.storage.activity.listActivities({ limit: 1, offset: 0 });
    expect(entry.new_value).toBe('Failed: Bad credentials');
  });

  it('never syncs more repos at once than the concurrency limit', async () => {
    mockGetRepos.mockResolvedValue(Array.from({ length: 9 }, (_, i) => gh(`r${i}`)));
    let active = 0;
    let peak = 0;
    mockSyncRepoHealth.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return {};
    });
    const summary = await runFullSync(context(), { concurrency: 2 });
    expect(summary.repos.synced).toBe(9);
    expect(peak).toBe(2);
  });

  it('runs one sync at a time and exposes its status', async () => {
    let release!: () => void;
    mockSyncRepoHealth.mockImplementation(() => new Promise((resolve) => { release = () => resolve({}); }));
    mockGetRepos.mockResolvedValue([gh('a')]);
    const ctx = context();

    expect(getSyncStatus(ctx)).toEqual({ running: false, progress: null, lastRun: null });
    const first = startFullSync(ctx);
    const second = startFullSync(ctx);
    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.finished).toBe(first.finished);
    expect(getSyncStatus(ctx).running).toBe(true);

    await vi.waitFor(() => expect(mockSyncRepoHealth).toHaveBeenCalled());
    expect(getSyncStatus(ctx).progress).toEqual({ phase: 'syncing', done: 0, total: 1 });
    release();
    const summary = await first.finished;

    expect(getSyncStatus(ctx)).toEqual({ running: false, progress: null, lastRun: summary });
    expect(startFullSync(ctx).started).toBe(true);
  });

  it('decides when a scheduled sync is due', () => {
    const now = new Date('2026-06-02T12:00:00Z');
    expect(isSyncDue(null, 24, now)).toBe(true);
    expect(isSyncDue('2026-06-01T11:59:00Z', 24, now)).toBe(true);
    expect(isSyncDue('2026-06-01T12:01:00Z', 24, now)).toBe(false);
    expect(isSyncDue(null, 0, now)).toBe(false);
    expect(isSyncDue('2020-01-01T00:00:00Z', Number('nonsense'), now)).toBe(false);
  });
});

describe('sync routes', () => {
  const env: any = { ...mockEnv, STORAGE_DRIVER: 'memory' };
  const auth = { Authorization: `Bearer ${mockEnv.API_KEY}` };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRepos.mockResolvedValue([gh('a')]);
    mockSyncRepoHealth.mockResolvedValue({});
    mockLatestRun.mockResolvedValue(null);
    mockTraffic.mockResolvedValue(false);
  });

  it('starts a sync in the background and reports the result afterwards', async () => {
    const started = await app.request('/api/sync', { method: 'POST', headers: auth }, env);
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ started: true, running: true });

    await vi.waitFor(async () => {
      const status = await (await app.request('/api/sync/status', { headers: auth }, env)).json();
      expect(status.running).toBe(false);
      expect(status.lastRun.repos).toMatchObject({ total: 1, synced: 1 });
    });
    expect(await createStorage(env).repos.getRepo('acme/a')).not.toBeNull();
  });

  it('requires a GitHub token and authentication', async () => {
    const noToken = await app.request('/api/sync', { method: 'POST', headers: auth }, { ...env, GITHUB_TOKEN: '' });
    expect(noToken.status).toBe(500);
    expect((await app.request('/api/sync', { method: 'POST' }, env)).status).toBe(401);
  });
});
