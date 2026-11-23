import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

const mockRepoGet = vi.fn();
const mockRepoUpdate = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({ repos: { get: mockRepoGet, update: mockRepoUpdate } }),
}));

import app from '@back/index';
import { diffConfig } from '@back/lib/signals/config';
import { BASELINE_SETTINGS, baselineValues, resolveBaseline } from '@back/domain/repo-baseline';
import type { Storage } from '@back/application/ports/storage';

const BASELINE = resolveBaseline(undefined);
let env: any;
let storage: Storage;

const compliant = Object.fromEntries(Object.entries(BASELINE).map(([k, v]) => [k, v.expected]));
const apply = (body?: unknown, headers: Record<string, string> = {}) => app.request('/api/repos/acme/api/config/apply', {
  method: 'POST',
  headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, ...headers },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
}, env);

describe('diffConfig', () => {
  it('reports no drift for a compliant repo', () => {
    const result = diffConfig({ ...compliant, permissions: { admin: true } }, BASELINE);
    expect(result).toMatchObject({ applicable: true, canApply: true, drift: 0, unknown: 0 });
    expect(result.settings).toHaveLength(Object.keys(BASELINE).length);
  });

  it('flags each setting that differs from the baseline', () => {
    const result = diffConfig({ ...compliant, delete_branch_on_merge: false, has_wiki: true }, BASELINE);
    expect(result.drift).toBe(2);
    expect(result.settings.filter(s => s.drift).map(s => s.key)).toEqual(['delete_branch_on_merge', 'has_wiki']);
    expect(result.canApply).toBe(false);
  });

  it('treats fields GitHub did not return as unknown, not as drift', () => {
    const result = diffConfig({ has_wiki: false }, BASELINE);
    expect(result.drift).toBe(0);
    expect(result.unknown).toBe(Object.keys(BASELINE).length - 1);
  });

  it('does not ask archived repos for changes', () => {
    const result = diffConfig({ ...compliant, has_wiki: true, archived: true, permissions: { admin: true } }, BASELINE);
    expect(result).toMatchObject({ applicable: false, canApply: false, drift: 0 });
  });

  it('accepts a custom baseline', () => {
    const result = diffConfig({ has_issues: false }, { has_issues: { expected: true, label: 'Issues' } });
    expect(result.settings).toEqual([{ key: 'has_issues', label: 'Issues', expected: true, actual: false, drift: true }]);
  });
});

describe('POST /api/repos/:owner/:repo/config/apply', () => {
  const changes = async () =>
    (await storage.activity.listActivities({ limit: 50, offset: 0 })).filter((a: any) => a.action === 'repo.config_apply');

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([repoRecord('acme/api')]);
    mockRepoGet.mockResolvedValue({ data: { ...compliant, delete_branch_on_merge: false, has_wiki: true, permissions: { admin: true } } });
    mockRepoUpdate.mockResolvedValue({});
  });

  it('changes only the drifting settings, logs each one and refreshes the signal', async () => {
    const res = await apply(undefined, { 'X-Actor-Name': 'someone' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRepoUpdate).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', delete_branch_on_merge: true, has_wiki: false });
    expect(body.applied).toEqual([
      { key: 'delete_branch_on_merge', label: expect.any(String), from: false, to: true },
      { key: 'has_wiki', label: expect.any(String), from: true, to: false },
    ]);
    const logged = await changes();
    expect(logged).toHaveLength(2);
    expect(logged).toContainEqual(expect.objectContaining({
      entity_id: 'acme/api', field_changed: 'delete_branch_on_merge', old_value: 'false', new_value: 'true', actor_name: 'someone',
    }));
    expect((await storage.signals.getRepoSignals('acme/api')).map(r => r.kind)).toEqual(['config']);
  });

  it('limits the change to the requested keys', async () => {
    const body = await (await apply({ keys: ['has_wiki'] })).json();
    expect(mockRepoUpdate).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', has_wiki: false });
    expect(body.applied).toHaveLength(1);
  });

  it('does nothing for a compliant repo', async () => {
    mockRepoGet.mockResolvedValue({ data: compliant });
    const body = await (await apply({})).json();

    expect(body.applied).toEqual([]);
    expect(mockRepoUpdate).not.toHaveBeenCalled();
    expect(await changes()).toEqual([]);
    expect(await storage.signals.getRepoSignals('acme/api')).toEqual([]);
  });

  it('rejects keys that are not in the baseline, an empty key list and invalid JSON', async () => {
    const unknown = await apply({ keys: ['visibility'] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain('visibility');

    expect((await apply({ keys: [] })).status).toBe(400);
    expect((await apply('{nope')).status).toBe(400);
    expect(mockRepoGet).not.toHaveBeenCalled();
  });

  it('refuses archived repos', async () => {
    mockRepoGet.mockResolvedValue({ data: { ...compliant, has_wiki: true, archived: true } });
    const res = await apply();
    expect(res.status).toBe(409);
    expect(mockRepoUpdate).not.toHaveBeenCalled();
  });

  it('maps GitHub failures to clear statuses', async () => {
    mockRepoGet.mockRejectedValueOnce({ status: 404, message: 'Not Found' });
    expect((await apply()).status).toBe(404);

    mockRepoGet.mockRejectedValueOnce({});
    expect((await apply()).status).toBe(502);

    mockRepoUpdate.mockRejectedValueOnce({ status: 403 });
    const forbidden = await apply();
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toContain('admin access required');

    mockRepoUpdate.mockRejectedValueOnce({ status: 422, message: 'Validation Failed' });
    const rejected = await apply();
    expect(rejected.status).toBe(502);
    expect((await rejected.json()).error).toContain('Validation Failed');

    mockRepoUpdate.mockRejectedValueOnce({});
    expect((await (await apply()).json()).error).toContain('unknown error');
    expect(await changes()).toEqual([]);
  });

  it('exposes the drift as the config signal', async () => {
    const res = await app.request('/api/repos/acme/api/signals/sync?kinds=config', {
      method: 'POST', headers: { Authorization: `Bearer ${mockEnv.API_KEY}` },
    }, env);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ kind: 'config', ok: true, data: { drift: 2, canApply: true } });
  });

  it('uses the configured baseline instead of the defaults', async () => {
    env.REPO_BASELINE = JSON.stringify({ has_wiki: true, has_issues: false });
    mockRepoGet.mockResolvedValue({ data: { has_wiki: true, has_issues: true, delete_branch_on_merge: false, permissions: { admin: true } } });

    const body = await (await apply()).json();

    expect(mockRepoUpdate).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', has_issues: false });
    expect(body.applied.map((c: any) => c.key)).toEqual(['has_issues']);
  });
});

describe('repo baseline', () => {
  it('enforces the default settings when nothing is configured', () => {
    for (const raw of [undefined, '', '   ', '{nope', '[]', 'null', '3']) {
      expect(Object.keys(resolveBaseline(raw)).sort()).toEqual([
        'allow_merge_commit', 'allow_squash_merge', 'allow_update_branch', 'delete_branch_on_merge', 'has_wiki',
      ]);
    }
  });

  it('enforces exactly the configured settings, dropping unknown keys and non-boolean values', () => {
    const raw = JSON.stringify({ has_issues: false, has_wiki: 'yes', made_up: true, allow_auto_merge: true });
    expect(baselineValues(raw)).toEqual({ has_issues: false, allow_auto_merge: true });
    expect(resolveBaseline(raw)).toEqual({
      allow_auto_merge: { expected: true, label: expect.any(String) },
      has_issues: { expected: false, label: 'Issues' },
    });
  });

  it('can be configured to enforce nothing', () => {
    expect(resolveBaseline('{}')).toEqual({});
  });

  it('every catalog entry has a unique key', () => {
    const keys = BASELINE_SETTINGS.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
