import { describe, it, expect, vi } from 'vitest';
import { analyzeBranches, collectBranches, type BranchInput, type PullInput } from '@back/lib/signals/branches';
import { createSignalContext } from '@back/lib/signals';

const NOW = new Date('2026-11-23T12:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const branch = (name: string, extra: Partial<BranchInput> = {}): BranchInput => ({
  name, sha: `sha-${name}`, protected: false, lastCommitAt: daysAgo(1), ahead: 1, behind: 0, ...extra,
});
const pull = (headRef: string, extra: Partial<PullInput> = {}): PullInput => ({
  number: 1, title: 't', url: 'u', state: 'closed', draft: false, headRef, headSha: `sha-${headRef}`,
  sameRepo: true, mergedAt: null, updatedAt: daysAgo(1), ...extra,
});
const statusOf = (result: ReturnType<typeof analyzeBranches>, name: string) => result.items.find(i => i.name === name);

describe('analyzeBranches', () => {
  it('skips the default branch and protected branches', () => {
    const result = analyzeBranches('main', [branch('main'), branch('release', { protected: true }), branch('feat')], [], NOW);
    expect(result.items.map(i => i.name)).toEqual(['feat']);
    expect(result.total).toBe(3);
  });

  it('marks a branch merged when a merged PR points at its current commit (squash-safe)', () => {
    const result = analyzeBranches('main', [branch('feat', { ahead: 3 })], [pull('feat', { mergedAt: daysAgo(2), number: 7 })], NOW);
    expect(statusOf(result, 'feat')).toMatchObject({ status: 'merged', mergedVia: 'pr', pr: { number: 7, state: 'merged' } });
  });

  it('does not trust a merged PR if the branch moved after the merge', () => {
    const result = analyzeBranches('main', [branch('feat', { ahead: 2 })], [pull('feat', { mergedAt: daysAgo(2), headSha: 'older' })], NOW);
    expect(statusOf(result, 'feat')).toMatchObject({ status: 'active', mergedVia: null });
  });

  it('ignores PRs coming from forks with the same branch name', () => {
    const result = analyzeBranches('main', [branch('patch-1')], [pull('patch-1', { mergedAt: daysAgo(2), sameRepo: false })], NOW);
    expect(statusOf(result, 'patch-1')).toMatchObject({ status: 'active', pr: null });
  });

  it('marks a branch merged when it has no commits of its own', () => {
    const result = analyzeBranches('main', [branch('done', { ahead: 0, behind: 12 })], [], NOW);
    expect(statusOf(result, 'done')).toMatchObject({ status: 'merged', mergedVia: 'ancestor' });
  });

  it('keeps a fresh branch with an open PR active even with no commits ahead', () => {
    const result = analyzeBranches('main', [branch('wip', { ahead: 0 })], [pull('wip', { state: 'open' })], NOW);
    expect(statusOf(result, 'wip')).toMatchObject({ status: 'active', pr: { state: 'open' } });
  });

  it('marks old branches stale unless they have an open PR or an unknown date', () => {
    const result = analyzeBranches('main', [
      branch('old', { lastCommitAt: daysAgo(200) }),
      branch('old-with-pr', { lastCommitAt: daysAgo(200) }),
      branch('no-date', { lastCommitAt: null, ahead: null }),
      branch('recent', { lastCommitAt: daysAgo(89) }),
    ], [pull('old-with-pr', { state: 'open' })], NOW);

    expect(statusOf(result, 'old')!.status).toBe('stale');
    expect(statusOf(result, 'old-with-pr')!.status).toBe('active');
    expect(statusOf(result, 'no-date')!.status).toBe('active');
    expect(statusOf(result, 'recent')!.status).toBe('active');
  });

  it('counts and sorts merged first, then stale, then active', () => {
    const result = analyzeBranches('main', [
      branch('b-active'), branch('a-stale', { lastCommitAt: daysAgo(100) }), branch('c-merged', { ahead: 0 }),
    ], [], NOW);
    expect(result.items.map(i => i.name)).toEqual(['c-merged', 'a-stale', 'b-active']);
    expect(result).toMatchObject({ merged: 1, stale: 1 });
  });

  it('lists open PRs without activity', () => {
    const result = analyzeBranches('main', [], [
      pull('a', { state: 'open', updatedAt: daysAgo(45), number: 3, draft: true }),
      pull('b', { state: 'open', updatedAt: daysAgo(5) }),
      pull('c', { state: 'closed', updatedAt: daysAgo(400) }),
    ], NOW);
    expect(result).toMatchObject({ openPrs: 2, stalePrCount: 1 });
    expect(result.stalePrs[0]).toMatchObject({ number: 3, draft: true });
  });

  it('links a closed, unmerged PR for context', () => {
    const result = analyzeBranches('main', [branch('feat')], [pull('feat', { number: 9 })], NOW);
    expect(statusOf(result, 'feat')!.pr).toEqual({ number: 9, url: 'u', state: 'closed' });
  });
});

describe('collectBranches', () => {
  const rawPull = (ref: string, sha: string, extra: Record<string, any> = {}) => ({
    number: 5, title: 'PR', html_url: 'https://x/pr/5', state: 'closed', draft: false,
    head: { ref, sha, repo: { full_name: 'Me/Api' } }, merged_at: null, updated_at: '2026-11-22T00:00:00Z', ...extra,
  });
  const fakeOctokit = (overrides: Record<string, any> = {}) => ({
    repos: {
      get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
      listBranches: vi.fn().mockResolvedValue({ data: [
        { name: 'main', commit: { sha: 'm' }, protected: true },
        { name: 'squashed', commit: { sha: 's1' }, protected: false },
        { name: 'plain', commit: { sha: 'p1' } },
      ] }),
      compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { ahead_by: 0, behind_by: 4 } }),
      ...overrides.repos,
    },
    pulls: { list: vi.fn().mockResolvedValue({ data: [rawPull('squashed', 's1', { merged_at: '2026-11-20T00:00:00Z' })] }), ...overrides.pulls },
    graphql: overrides.graphql ?? vi.fn().mockResolvedValue({
      repository: { refs: { nodes: [{ name: 'plain', target: { committedDate: '2026-11-21T00:00:00Z' } }, { name: 'tagish', target: {} }] } },
    }),
  }) as any;
  const collect = (octokit: any) => collectBranches(createSignalContext(octokit, 'me', 'api')) as Promise<any>;

  it('compares only branches without merged-PR evidence', async () => {
    const octokit = fakeOctokit();
    const result = await collect(octokit);

    expect(octokit.repos.compareCommitsWithBasehead).toHaveBeenCalledTimes(1);
    expect(octokit.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({ owner: 'me', repo: 'api', basehead: 'main...plain', per_page: 1 });
    expect(result).toMatchObject({ defaultBranch: 'main', total: 3, merged: 2, truncated: false });
    expect(result.items.find((i: any) => i.name === 'squashed')).toMatchObject({ mergedVia: 'pr', sha: 's1' });
    expect(result.items.find((i: any) => i.name === 'plain')).toMatchObject({ mergedVia: 'ancestor', lastCommitAt: '2026-11-21T00:00:00Z', behind: 4 });
  });

  it('works without commit dates and with incomparable branches', async () => {
    const octokit = fakeOctokit({
      graphql: vi.fn().mockRejectedValue(new Error('graphql down')),
      repos: { compareCommitsWithBasehead: vi.fn().mockRejectedValue({ status: 404 }) },
      pulls: { list: vi.fn().mockResolvedValue({ data: [rawPull('x', 'y', { state: 'open', draft: true, head: { ref: 'x', sha: 'y', repo: null } })] }) },
    });
    const result = await collect(octokit);

    expect(result.items.every((i: any) => i.lastCommitAt === null && i.status === 'active')).toBe(true);
    expect(result.openPrs).toBe(1);
  });

  it('tolerates an empty GraphQL result', async () => {
    const result = await collect(fakeOctokit({ graphql: vi.fn().mockResolvedValue(null) }));
    expect(result.total).toBe(3);
  });

  it('propagates unexpected compare errors', async () => {
    const boom = { status: 500 };
    await expect(collect(fakeOctokit({ repos: { compareCommitsWithBasehead: vi.fn().mockRejectedValue(boom) } }))).rejects.toBe(boom);
  });

  it('flags a truncated branch list and caps comparisons', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}`, commit: { sha: `s${i}` }, protected: false }));
    const octokit = fakeOctokit({ repos: { listBranches: vi.fn().mockResolvedValue({ data: many }) }, pulls: { list: vi.fn().mockResolvedValue({ data: [] }) } });
    const result = await collect(octokit);

    expect(result.truncated).toBe(true);
    expect(octokit.repos.compareCommitsWithBasehead).toHaveBeenCalledTimes(25);
  });
});
