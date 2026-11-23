import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ctxFor } from '../helpers';

const mockGetReposWithMetrics = vi.fn();
vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: (...args: any[]) => mockGetReposWithMetrics(...args),
}));

const mockRefreshFromGitHub = vi.fn();
vi.mock('@back/infrastructure/storage/sql/repo.repository', () => ({
  refreshFromGitHub: (...args: any[]) => mockRefreshFromGitHub(...args),
}));

import { refreshFromGitHub } from '@back/services/repo-sync.service';

const env: any = { DATABASE_URL: 'postgresql://test', GITHUB_TOKEN: 'ghp_test' };

describe('repo-sync.service', () => {
  beforeEach(() => {
    mockGetReposWithMetrics.mockReset();
    mockRefreshFromGitHub.mockReset();
  });

  it('returns early when no repos found', async () => {
    mockGetReposWithMetrics.mockResolvedValueOnce([]);

    const result = await refreshFromGitHub(ctxFor(env));

    expect(result.synced).toBe(0);
    expect(result.total).toBe(0);
    expect(result.removed).toBe(0);
    expect(mockRefreshFromGitHub).not.toHaveBeenCalled();
  });

  it('syncs repos and returns stats', async () => {
    const repos = [
      { full_name: 'owner/a' },
      { full_name: 'owner/b' },
    ];
    mockGetReposWithMetrics.mockResolvedValueOnce(repos);
    mockRefreshFromGitHub.mockResolvedValueOnce({
      removedRepos: ['owner/old'],
      restoredRepos: [],
    });

    const result = await refreshFromGitHub(ctxFor(env));

    expect(result.synced).toBe(2);
    expect(result.total).toBe(2);
    expect(result.removed).toBe(1);
    expect(result.removedRepos).toEqual(['owner/old']);
    expect(result.restoredRepos).toBeUndefined();
    expect(result.timestamp).toBeDefined();
  });

  it('includes restoredRepos when repos are restored', async () => {
    mockGetReposWithMetrics.mockResolvedValueOnce([{ full_name: 'o/r' }]);
    mockRefreshFromGitHub.mockResolvedValueOnce({
      removedRepos: [],
      restoredRepos: ['o/restored'],
    });

    const result = await refreshFromGitHub(ctxFor(env));

    expect(result.removed).toBe(0);
    expect(result.removedRepos).toBeUndefined();
    expect(result.restoredRepos).toEqual(['o/restored']);
  });
});
