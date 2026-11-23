import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

const issuesList = vi.fn();
const pullsList = vi.fn();
const pullsGet = vi.fn();
const pullsMerge = vi.fn();
const checksList = vi.fn();
const combinedStatus = vi.fn();
const getAuthenticated = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    issues: { listForRepo: issuesList },
    pulls: { list: pullsList, get: pullsGet, merge: pullsMerge },
    checks: { listForRef: checksList },
    repos: { getCombinedStatusForRef: combinedStatus },
    users: { getAuthenticated },
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { buildInbox } from '@back/lib/signals/inbox';

let env: any;
let storage: Storage;
let tokens = 0;

const SHA = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const request = (path: string, init: RequestInit = {}) => app.request(path, {
  ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}`, 'Content-Type': 'application/json' },
}, env);
const post = (path: string, body?: unknown) =>
  request(path, { method: 'POST', body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body) });

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number, title: `Issue ${number}`, html_url: `https://github.com/acme/api/issues/${number}`,
  user: { login: 'bob', type: 'User' }, labels: [{ name: 'bug', color: 'd73a4a' }, 'help wanted'],
  assignees: [{ login: 'alice' }], comments: 2, created_at: '2026-01-01T00:00:00Z', updated_at: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`,
  ...extra,
});
const prIssue = (number: number, extra: Record<string, unknown> = {}) =>
  issue(number, { title: `PR ${number}`, html_url: `https://github.com/acme/api/pull/${number}`, pull_request: {}, labels: [], assignees: [], ...extra });
const pull = (number: number, extra: Record<string, unknown> = {}) => ({
  number, draft: false, requested_reviewers: [{ login: 'alice' }], head: { ref: `feat/${number}`, sha: SHA }, ...extra,
});

describe('inbox signal', () => {
  it('merges the issue listing with what only pull requests know', () => {
    const inbox = buildInbox(
      [issue(3), prIssue(7), prIssue(9, { user: { login: 'dependabot[bot]', type: 'Bot' } })],
      [pull(7), pull(9, { draft: true, requested_reviewers: [] })],
    );

    expect(inbox).toMatchObject({ prs: 2, issues: 1 });
    expect(inbox.items[0]).toEqual({
      type: 'issue', number: 3, title: 'Issue 3', url: 'https://github.com/acme/api/issues/3',
      author: 'bob', authorIsBot: false, labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'help wanted', color: null }],
      assignees: ['alice'], requestedReviewers: [], draft: false, comments: 2,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z', headRef: null, headSha: null,
    });
    expect(inbox.items[1]).toMatchObject({ type: 'pr', number: 7, requestedReviewers: ['alice'], headRef: 'feat/7', headSha: SHA, draft: false });
    expect(inbox.items[2]).toMatchObject({ author: 'dependabot[bot]', authorIsBot: true, draft: true });
  });

  it('copes with a pull request missing from the pull listing and with deleted users', () => {
    const inbox = buildInbox([prIssue(7, { user: null, draft: true })], []);
    expect(inbox.items[0]).toMatchObject({ author: null, authorIsBot: false, draft: true, headSha: null, requestedReviewers: [] });
  });
});

describe('inbox API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // A token of its own per test: the viewer's login is remembered per token.
    ({ env, storage } = memoryEnv({ GITHUB_TOKEN: `ghp_inbox_${++tokens}` }));
    await storage.repos.refreshFromGitHub([repoRecord('acme/api'), repoRecord('acme/web'), repoRecord('acme/old', { is_archived: true })]);
    getAuthenticated.mockResolvedValue({ data: { login: 'alice' } });
    issuesList.mockImplementation(async ({ repo }: any) => ({ data: repo === 'api' ? [issue(3), prIssue(7)] : [] }));
    pullsList.mockResolvedValue({ data: [pull(7)] });
    pullsGet.mockResolvedValue({ data: { state: 'open', draft: false, head: { sha: SHA } } });
    pullsMerge.mockResolvedValue({ data: { merged: true } });
    checksList.mockResolvedValue({ data: { check_runs: [{ status: 'completed', conclusion: 'success' }] } });
    combinedStatus.mockResolvedValue({ data: { state: 'pending', statuses: [] } });
  });

  describe('GET /api/inbox', () => {
    it('is empty before any sync', async () => {
      expect(await (await request('/api/inbox')).json()).toEqual({
        viewer: 'alice', items: [], reposSynced: 0, reposTotal: 2, oldestCheck: null, truncated: [],
      });
    });

    it('lists the open items of every active repo after a refresh, newest first', async () => {
      await storage.meta.patchRepoMeta('acme/api', { priority: 'high' });
      expect(await (await post('/api/inbox/refresh')).json()).toEqual({ repos: 2, failed: 0 });

      const inbox = await (await request('/api/inbox')).json() as any;
      expect(inbox).toMatchObject({ viewer: 'alice', reposSynced: 2, reposTotal: 2, truncated: [] });
      expect(inbox.items.map((item: any) => `${item.repo}#${item.number}`)).toEqual(['acme/api#7', 'acme/api#3']);
      expect(inbox.items[0]).toMatchObject({ type: 'pr', repo: 'acme/api', priority: 'high', groups: [], headSha: SHA });
      expect(typeof inbox.oldestCheck).toBe('string');
      // One listing per repo; the pull listing only where there are pull requests.
      expect(issuesList).toHaveBeenCalledTimes(2);
      expect(pullsList).toHaveBeenCalledTimes(1);
    });

    it('leaves out repos that were archived or paused since', async () => {
      await post('/api/inbox/refresh');
      await storage.meta.patchRepoMeta('acme/api', { priority: 'paused' });
      expect((await (await request('/api/inbox')).json() as any).items).toEqual([]);
    });

    it('reports repos with more items than it keeps, and repos it could not read', async () => {
      issuesList.mockImplementation(async ({ repo }: any) => {
        if (repo === 'web') throw Object.assign(new Error('boom'), { status: 500 });
        return { data: Array.from({ length: 100 }, (_, i) => issue(i + 1)) };
      });
      expect(await (await post('/api/inbox/refresh')).json()).toEqual({ repos: 2, failed: 1 });
      expect((await (await request('/api/inbox')).json() as any).truncated).toEqual(['acme/api']);
    });

    it('works without knowing who the viewer is', async () => {
      getAuthenticated.mockRejectedValue(new Error('bad credentials'));
      expect((await (await request('/api/inbox')).json() as any).viewer).toBeNull();
    });

    it('treats a repo whose issues cannot be listed as empty', async () => {
      issuesList.mockRejectedValue(Object.assign(new Error('gone'), { status: 410 }));
      expect(await (await post('/api/inbox/refresh')).json()).toEqual({ repos: 2, failed: 0 });
      expect((await storage.signals.getRepoSignals('acme/api'))[0].data).toMatchObject({ available: false, items: [] });
    });
  });

  describe('POST /api/inbox/merge', () => {
    const merge = (pulls: unknown = [{ repo: 'acme/api', number: 7, sha: SHA }], method?: string) =>
      post('/api/inbox/merge', { pulls, ...(method && { method }) });
    const merges = async () =>
      (await storage.activity.listActivities({ limit: 50, offset: 0 })).filter((a: any) => a.action === 'repo.pr_merge');

    it('merges, pinned to the commit that was listed, logs it and refreshes the repo', async () => {
      const res = await merge();
      expect(await res.json()).toEqual({ merged: 1, skipped: 0, results: [{ repo: 'acme/api', number: 7, merged: true }] });
      expect(pullsMerge).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 7, sha: SHA, merge_method: 'squash' });
      expect(await merges()).toEqual([expect.objectContaining({
        entity_id: 'acme/api', new_value: '#7', metadata: { number: 7, sha: SHA, method: 'squash' },
      })]);
      expect(issuesList).toHaveBeenCalledWith(expect.objectContaining({ repo: 'api' }));
    });

    it('uses the requested merge method', async () => {
      await merge(undefined, 'rebase');
      expect(pullsMerge).toHaveBeenCalledWith(expect.objectContaining({ merge_method: 'rebase' }));
    });

    it.each([
      ['closed', () => pullsGet.mockResolvedValue({ data: { state: 'closed', draft: false, head: { sha: SHA } } })],
      ['draft', () => pullsGet.mockResolvedValue({ data: { state: 'open', draft: true, head: { sha: SHA } } })],
      ['moved', () => pullsGet.mockResolvedValue({ data: { state: 'open', draft: false, head: { sha: 'f'.repeat(40) } } })],
      ['checks_failing', () => checksList.mockResolvedValue({ data: { check_runs: [{ status: 'completed', conclusion: 'failure' }] } })],
      ['checks_failing', () => combinedStatus.mockResolvedValue({ data: { state: 'failure', statuses: [{}] } })],
      ['checks_pending', () => checksList.mockResolvedValue({ data: { check_runs: [{ status: 'in_progress', conclusion: null }] } })],
      ['checks_pending', () => combinedStatus.mockResolvedValue({ data: { state: 'pending', statuses: [{}] } })],
      ['gone', () => pullsGet.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))],
    ])('skips a pull request that is %s', async (reason, arrange) => {
      arrange();
      const body = await (await merge()).json() as any;
      expect(body).toMatchObject({ merged: 0, skipped: 1, results: [{ merged: false, reason }] });
      expect(pullsMerge).not.toHaveBeenCalled();
      expect(await merges()).toEqual([]);
    });

    it('reports what GitHub refuses to merge, and other failures', async () => {
      pullsMerge.mockRejectedValueOnce(Object.assign(new Error('Pull Request is not mergeable'), { status: 405 }));
      expect((await (await merge()).json() as any).results[0]).toEqual({
        repo: 'acme/api', number: 7, merged: false, reason: 'not_mergeable', error: 'Pull Request is not mergeable',
      });
      pullsMerge.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }));
      expect((await (await merge()).json() as any).results[0]).toMatchObject({ reason: 'error', error: 'Server Error' });
    });

    it('merges what it can and reports the rest, one by one', async () => {
      pullsGet.mockImplementation(async ({ pull_number }: any) => ({
        data: { state: 'open', draft: pull_number === 8, head: { sha: SHA } },
      }));
      const body = await (await merge([
        { repo: 'acme/api', number: 7, sha: SHA }, { repo: 'acme/api', number: 8, sha: SHA }, { repo: 'acme/web', number: 2, sha: SHA },
      ])).json() as any;
      expect(body).toMatchObject({ merged: 2, skipped: 1 });
      expect(body.results.map((r: any) => r.reason ?? 'merged')).toEqual(['merged', 'draft', 'merged']);
      expect(await merges()).toHaveLength(2);
    });

    it('refuses repos the dashboard does not track, and malformed requests', async () => {
      expect((await merge([{ repo: 'other/secret', number: 1, sha: SHA }])).status).toBe(400);
      expect((await merge([{ repo: 'acme/old', number: 1, sha: SHA }])).status).toBe(400);   // archived
      expect((await merge([])).status).toBe(400);
      expect((await merge([{ repo: 'acme/api', number: 7, sha: 'not-a-sha' }])).status).toBe(400);
      expect((await merge([{ repo: 'acme', number: 7, sha: SHA }])).status).toBe(400);
      expect((await merge(undefined, 'yolo')).status).toBe(400);
      expect((await post('/api/inbox/merge', '{')).status).toBe(400);
      expect(pullsGet).not.toHaveBeenCalled();
    });
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/inbox', {}, env)).status).toBe(401);
    expect((await app.request('/api/inbox/merge', { method: 'POST' }, env)).status).toBe(401);
  });
});
