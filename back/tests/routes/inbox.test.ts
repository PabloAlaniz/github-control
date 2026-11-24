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
const graphql = vi.fn();
const issuesGet = vi.fn();
const listFiles = vi.fn();
const createReview = vi.fn();
const createComment = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    issues: { listForRepo: issuesList, get: issuesGet, createComment },
    pulls: { list: pullsList, get: pullsGet, merge: pullsMerge, listFiles, createReview },
    checks: { listForRef: checksList },
    repos: { getCombinedStatusForRef: combinedStatus },
    users: { getAuthenticated },
    graphql,
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { buildInbox, pullStates } from '@back/lib/signals/inbox';

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
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z', headRef: null, headSha: null, checks: null, review: null,
    });
    expect(inbox.items[1]).toMatchObject({ type: 'pr', number: 7, requestedReviewers: ['alice'], headRef: 'feat/7', headSha: SHA, draft: false });
    expect(inbox.items[2]).toMatchObject({ author: 'dependabot[bot]', authorIsBot: true, draft: true });
  });

  it('adds the check and review state of each pull request, never of an issue', () => {
    const states = pullStates({ repository: { pullRequests: { nodes: [
      { number: 7, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } },
      { number: 9, reviewDecision: 'CHANGES_REQUESTED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'ERROR' } } }] } },
      { number: 11, reviewDecision: null, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } },
      { number: 3, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } },
      { reviewDecision: 'APPROVED' },
    ] } } });
    const inbox = buildInbox([issue(3), prIssue(7), prIssue(9), prIssue(11), prIssue(13)], [pull(7), pull(9), pull(11), pull(13)], states);

    expect(inbox.items.map((item) => [item.number, item.checks, item.review])).toEqual([
      [3, null, null], [7, 'success', 'approved'], [9, 'failure', 'changes_requested'], [11, null, null], [13, null, null],
    ]);
    expect(pullStates({ repository: { pullRequests: { nodes: [{ number: 1, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'EXPECTED' } } }] }, reviewDecision: 'REVIEW_REQUIRED' }] } } }).get(1))
      .toEqual({ checks: 'pending', review: 'review_required' });
    expect(pullStates(null).size).toBe(0);
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
    graphql.mockResolvedValue({ repository: { pullRequests: { nodes: [
      { number: 7, reviewDecision: 'REVIEW_REQUIRED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } },
    ] } } });
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
      expect(inbox.items[0]).toMatchObject({ type: 'pr', repo: 'acme/api', priority: 'high', groups: [], headSha: SHA, checks: 'failure', review: 'review_required' });
      // One GraphQL query per repo that has pull requests.
      expect(graphql).toHaveBeenCalledTimes(1);
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

    it('lists pull requests without their state when it cannot be read', async () => {
      graphql.mockRejectedValue(new Error('Resource not accessible by personal access token'));
      expect(await (await post('/api/inbox/refresh')).json()).toEqual({ repos: 2, failed: 0 });
      expect((await (await request('/api/inbox')).json() as any).items[0]).toMatchObject({ number: 7, checks: null, review: null });
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

  describe('reading one item', () => {
    beforeEach(() => {
      issuesGet.mockResolvedValue({ data: { title: 'Add refunds', html_url: 'https://github.com/acme/api/pull/7', state: 'open', user: { login: 'bob' }, body: 'x'.repeat(7000), comments: 2, pull_request: {} } });
      pullsGet.mockResolvedValue({ data: { state: 'open', draft: false, head: { sha: SHA, ref: 'feat/refunds' }, base: { ref: 'main' }, additions: 120, deletions: 8, changed_files: 3, mergeable: true } });
      listFiles.mockResolvedValue({ data: [{ filename: 'src/refunds.ts', status: 'added', additions: 100, deletions: 0 }] });
    });

    it('returns what a pull request says and changes', async () => {
      const body = await (await request('/api/inbox/item?repo=acme/api&number=7')).json() as any;
      expect(body).toMatchObject({
        type: 'pr', repo: 'acme/api', number: 7, title: 'Add refunds', author: 'bob', headSha: SHA, baseRef: 'main',
        additions: 120, deletions: 8, changedFiles: 3, mergeable: true, bodyTruncated: true,
        files: [{ path: 'src/refunds.ts', status: 'added', additions: 100, deletions: 0 }],
      });
      expect(body.body).toHaveLength(6000);
    });

    it('returns an issue without asking for pull request data', async () => {
      issuesGet.mockResolvedValue({ data: { title: 'Timeouts', html_url: 'u', state: 'open', user: null, body: null, comments: 0 } });
      expect(await (await request('/api/inbox/item?repo=acme/api&number=3')).json()).toMatchObject({ type: 'issue', author: null, body: '', bodyTruncated: false });
      expect(pullsGet).not.toHaveBeenCalled();
    });

    it('refuses repos it does not track, bad input and items that do not exist', async () => {
      expect((await request('/api/inbox/item?repo=other/secret&number=1')).status).toBe(400);
      expect((await request('/api/inbox/item?repo=acme/api')).status).toBe(400);
      expect((await request('/api/inbox/item?repo=acme/api&number=abc')).status).toBe(400);
      issuesGet.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
      expect((await request('/api/inbox/item?repo=acme/api&number=99')).status).toBe(404);
    });
  });

  describe('POST /api/inbox/review', () => {
    const review = (body: Record<string, unknown> = {}) =>
      post('/api/inbox/review', { repo: 'acme/api', number: 7, event: 'approve', sha: SHA, ...body });
    const reviews = async () =>
      (await storage.activity.listActivities({ limit: 50, offset: 0 })).filter((a: any) => a.action === 'repo.pr_review');

    // Braces on purpose: a hook that returns a function gets it called as cleanup, and a mock is a function.
    beforeEach(() => { createReview.mockResolvedValue({ data: { html_url: 'https://github.com/acme/api/pull/7#pullrequestreview-1' } }); });

    it('approves the commit that was shown, logs it and refreshes the repo', async () => {
      const res = await review();
      expect(await res.json()).toEqual({ success: true, reviewUrl: 'https://github.com/acme/api/pull/7#pullrequestreview-1' });
      expect(createReview).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', pull_number: 7, commit_id: SHA, event: 'APPROVE' });
      expect(await reviews()).toEqual([expect.objectContaining({ entity_id: 'acme/api', new_value: '#7: approve', metadata: { number: 7, event: 'approve', sha: SHA } })]);
      expect(issuesList).toHaveBeenCalled();
    });

    it('requests changes or comments with the text given', async () => {
      await review({ event: 'request_changes', body: ' Needs tests ' });
      expect(createReview).toHaveBeenCalledWith(expect.objectContaining({ event: 'REQUEST_CHANGES', body: 'Needs tests' }));
      await review({ event: 'comment', body: 'Looks close' });
      expect(createReview).toHaveBeenLastCalledWith(expect.objectContaining({ event: 'COMMENT', body: 'Looks close' }));
    });

    it('refuses to review code that changed since it was shown, or a closed pull request', async () => {
      pullsGet.mockResolvedValue({ data: { state: 'open', draft: false, head: { sha: 'f'.repeat(40) } } });
      const moved = await review();
      expect(moved.status).toBe(409);
      expect((await moved.json() as any).error).toMatch(/new commits since you looked/);

      pullsGet.mockResolvedValue({ data: { state: 'closed', draft: false, head: { sha: SHA } } });
      expect((await review()).status).toBe(409);
      expect(createReview).not.toHaveBeenCalled();
      expect(await reviews()).toEqual([]);
    });

    it('reports what GitHub refuses, such as approving your own pull request', async () => {
      createReview.mockRejectedValue(Object.assign(new Error('Can not approve your own pull request'), { status: 422 }));
      const res = await review();
      expect(res.status).toBe(409);
      expect((await res.json() as any).error).toBe('GitHub refused: Can not approve your own pull request');

      createReview.mockRejectedValue(Object.assign(new Error('Resource not accessible'), { status: 403 }));
      expect((await review()).status).toBe(403);
    });

    it('needs text to comment or request changes, and valid input', async () => {
      expect((await review({ event: 'request_changes' })).status).toBe(400);
      expect((await review({ event: 'comment', body: '   ' })).status).toBe(400);
      expect((await review({ event: 'merge' })).status).toBe(400);
      expect((await review({ sha: 'nope' })).status).toBe(400);
      expect((await review({ repo: 'other/secret' })).status).toBe(400);
      expect((await post('/api/inbox/review', '{')).status).toBe(400);
      expect(createReview).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/inbox/comment', () => {
    beforeEach(() => { createComment.mockResolvedValue({ data: { html_url: 'https://github.com/acme/api/issues/3#issuecomment-1' } }); });

    it('comments on an issue or pull request and logs it', async () => {
      const res = await post('/api/inbox/comment', { repo: 'acme/api', number: 3, body: 'On it.' });
      expect(await res.json()).toEqual({ success: true, commentUrl: 'https://github.com/acme/api/issues/3#issuecomment-1' });
      expect(createComment).toHaveBeenCalledWith({ owner: 'acme', repo: 'api', issue_number: 3, body: 'On it.' });
      const log = (await storage.activity.listActivities({ limit: 50, offset: 0 })).filter((a: any) => a.action === 'repo.issue_comment');
      expect(log).toEqual([expect.objectContaining({ entity_id: 'acme/api', new_value: '#3: comment' })]);
      // The comment's text is not copied into the activity log.
      expect(JSON.stringify(log)).not.toContain('On it.');
    });

    it('refuses an empty comment, a repo it does not track and reports GitHub failures', async () => {
      expect((await post('/api/inbox/comment', { repo: 'acme/api', number: 3, body: '' })).status).toBe(400);
      expect((await post('/api/inbox/comment', { repo: 'other/secret', number: 3, body: 'hi' })).status).toBe(400);
      createComment.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
      expect((await post('/api/inbox/comment', { repo: 'acme/api', number: 3, body: 'hi' })).status).toBe(502);
    });
  });

  it('requires authentication', async () => {
    expect((await app.request('/api/inbox/review', { method: 'POST' }, env)).status).toBe(401);
    expect((await app.request('/api/inbox/comment', { method: 'POST' }, env)).status).toBe(401);
    expect((await app.request('/api/inbox', {}, env)).status).toBe(401);
    expect((await app.request('/api/inbox/merge', { method: 'POST' }, env)).status).toBe(401);
  });
});
