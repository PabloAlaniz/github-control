import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

const mockRepoGet = vi.fn();
const mockGetBranch = vi.fn();
const mockDeleteRef = vi.fn();
const mockListBranches = vi.fn();
const mockPullsList = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    repos: { get: mockRepoGet, getBranch: mockGetBranch, listBranches: mockListBranches, compareCommitsWithBasehead: vi.fn() },
    pulls: { list: mockPullsList },
    git: { deleteRef: mockDeleteRef },
    graphql: vi.fn().mockResolvedValue(null),
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';

let env: any;
let storage: Storage;

const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
function del(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/repos/acme/api/branches/delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env);
}

describe('POST /api/repos/:owner/:repo/branches/delete', () => {
  const deletions = async () =>
    (await storage.activity.listActivities({ limit: 50, offset: 0 })).filter((a: any) => a.action === 'repo.branch_delete');

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([repoRecord('acme/api')]);
    mockRepoGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockGetBranch.mockResolvedValue({ data: { protected: false, commit: { sha: SHA } } });
    mockDeleteRef.mockResolvedValue({});
    mockListBranches.mockResolvedValue({ data: [] });
    mockPullsList.mockResolvedValue({ data: [] });
  });

  it('deletes a branch that still points at the expected commit, logs it and refreshes the signal', async () => {
    const res = await del({ branches: [{ name: 'feat/x', sha: SHA }] }, { 'X-Actor-Name': 'someone' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ deleted: 1, skipped: 0, results: [{ name: 'feat/x', deleted: true }] });
    expect(mockDeleteRef).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', ref: 'heads/feat/x' });

    expect(await deletions()).toEqual([expect.objectContaining({
      entity_id: 'acme/api', old_value: 'feat/x', actor_name: 'someone', metadata: { branch: 'feat/x', sha: SHA },
    })]);
    expect((await storage.signals.getRepoSignals('acme/api')).map(r => r.kind)).toEqual(['branches']);
  });

  it.each([
    ['the default branch', 'main', {}, 'default'],
    ['a protected branch', 'release', { protected: true, commit: { sha: SHA } }, 'protected'],
    ['a branch that moved', 'feat', { protected: false, commit: { sha: 'f'.repeat(40) } }, 'moved'],
  ])('never deletes %s', async (_label, name, branchData, reason) => {
    mockGetBranch.mockResolvedValue({ data: branchData });

    const body = await (await del({ branches: [{ name, sha: SHA }] })).json();

    expect(body.results).toEqual([{ name, deleted: false, reason }]);
    expect(mockDeleteRef).not.toHaveBeenCalled();
    expect(await deletions()).toEqual([]);
    expect(mockListBranches).not.toHaveBeenCalled();
  });

  it('reports branches that are already gone or fail, and keeps going', async () => {
    mockGetBranch
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({ data: { protected: false, commit: { sha: SHA } } })
      .mockResolvedValueOnce({ data: { protected: false, commit: { sha: SHA } } })
      .mockResolvedValueOnce({ data: { protected: false, commit: { sha: SHA } } });
    mockDeleteRef.mockRejectedValueOnce({ status: 422, message: 'Reference does not exist' }).mockRejectedValueOnce({}).mockResolvedValueOnce({});

    const body = await (await del({ branches: ['a', 'b', 'c', 'd'].map(name => ({ name, sha: SHA })) })).json();

    expect(body.results).toEqual([
      { name: 'a', deleted: false, reason: 'gone' },
      { name: 'b', deleted: false, reason: 'error', error: 'Reference does not exist' },
      { name: 'c', deleted: false, reason: 'error', error: 'unknown error' },
      { name: 'd', deleted: true },
    ]);
    expect(body).toMatchObject({ deleted: 1, skipped: 3 });
  });

  it.each([
    ['an empty list', { branches: [] }],
    ['a missing sha', { branches: [{ name: 'x' }] }],
    ['a sha that is not a hash', { branches: [{ name: 'x', sha: 'HEAD' }] }],
    ['more than 50 branches', { branches: Array.from({ length: 51 }, (_, i) => ({ name: `b${i}`, sha: SHA })) }],
  ])('rejects %s', async (_label, payload) => {
    const res = await del(payload);
    expect(res.status).toBe(400);
    expect(mockRepoGet).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON', async () => {
    expect((await del('{nope')).status).toBe(400);
  });

  it('returns 404 when the repo does not exist and 502 on other GitHub failures', async () => {
    mockRepoGet.mockRejectedValueOnce({ status: 404, message: 'Not Found' });
    expect((await del({ branches: [{ name: 'x', sha: SHA }] })).status).toBe(404);

    mockRepoGet.mockRejectedValueOnce({});
    const res = await del({ branches: [{ name: 'x', sha: SHA }] });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('unknown error');
  });
});
