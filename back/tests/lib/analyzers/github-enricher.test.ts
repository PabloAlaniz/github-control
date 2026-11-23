import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichFromGitHub, enrichBatch } from '@back/lib/analyzers/github-enricher';

function makeMockOctokit(overrides?: Partial<any>) {
  return {
    repos: {
      get: vi.fn().mockResolvedValue({
        data: {
          description: 'A test repo',
          language: 'TypeScript',
          default_branch: 'main',
          stargazers_count: 42,
          forks_count: 5,
          watchers_count: 10,
          subscribers_count: 3,
          open_issues_count: 2,
          topics: ['typescript', 'api'],
          license: { key: 'mit', name: 'MIT License' },
          homepage: 'https://example.com',
          fork: false,
          parent: null,
          is_template: false,
          private: false,
          archived: false,
          has_issues: true,
          has_projects: true,
          has_wiki: true,
          has_pages: false,
          has_discussions: true,
          size: 2048,
          pushed_at: '2026-03-01T00:00:00Z',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2026-03-01T12:00:00Z',
          ...overrides,
        },
      }),
    },
  } as any;
}

describe('github-enricher', () => {
  describe('enrichFromGitHub', () => {
    it('maps all GitHub API fields correctly', async () => {
      const octokit = makeMockOctokit();
      const result = await enrichFromGitHub(octokit, 'owner', 'repo');

      expect(result.description).toBe('A test repo');
      expect(result.stars).toBe(42);
      expect(result.forks).toBe(5);
      expect(result.license_key).toBe('mit');
      expect(result.license_name).toBe('MIT License');
      expect(result.homepage).toBe('https://example.com');
      expect(result.is_fork).toBe(false);
      expect(result.parent_repo).toBeNull();
      expect(result.has_discussions).toBe(true);
      expect(result.repo_size_kb).toBe(2048);
    });

    it('handles null license', async () => {
      const octokit = makeMockOctokit({ license: null });
      const result = await enrichFromGitHub(octokit, 'owner', 'repo');

      expect(result.license_key).toBeNull();
      expect(result.license_name).toBeNull();
    });

    it('handles fork with parent', async () => {
      const octokit = makeMockOctokit({
        fork: true,
        parent: { full_name: 'original/repo' },
      });
      const result = await enrichFromGitHub(octokit, 'owner', 'repo');

      expect(result.is_fork).toBe(true);
      expect(result.parent_repo).toBe('original/repo');
    });
  });

  describe('enrichBatch', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('enriches all repos in batch', async () => {
      const octokit = makeMockOctokit();
      const repos = [
        { owner: 'o', name: 'a', full_name: 'o/a' },
        { owner: 'o', name: 'b', full_name: 'o/b' },
      ];

      const promise = enrichBatch(octokit, repos, { delayMs: 0 });
      const results = await promise;

      expect(results.size).toBe(2);
      expect(results.has('o/a')).toBe(true);
      expect(results.has('o/b')).toBe(true);
    });

    it('calls onProgress callback', async () => {
      const octokit = makeMockOctokit();
      const onProgress = vi.fn();
      const repos = [{ owner: 'o', name: 'a', full_name: 'o/a' }];

      await enrichBatch(octokit, repos, { delayMs: 0, onProgress });

      expect(onProgress).toHaveBeenCalledWith(1, 1, 'o/a');
    });

    it('retries on rate limit with reset header', async () => {
      const reposGet = vi.fn();
      // First call: rate limit, second call: success
      reposGet
        .mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
          status: 403,
          response: { headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) } },
        }))
        .mockResolvedValueOnce({
          data: {
            description: null, language: null, default_branch: 'main',
            stargazers_count: 0, forks_count: 0, watchers_count: 0,
            subscribers_count: 0, open_issues_count: 0, topics: [],
            license: null, homepage: null, fork: false, parent: null,
            is_template: false, private: false, archived: false,
            has_issues: false, has_projects: false, has_wiki: false,
            has_pages: false, has_discussions: false, size: 0,
            pushed_at: null, created_at: null, updated_at: null,
          },
        });
      const octokit = { repos: { get: reposGet } } as any;
      const repos = [{ owner: 'o', name: 'a', full_name: 'o/a' }];

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const promise = enrichBatch(octokit, repos, { delayMs: 0 });
      // Advance past the rate limit wait
      await vi.advanceTimersByTimeAsync(5000);
      const results = await promise;

      expect(results.size).toBe(1);
      expect(reposGet).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    it('warns and skips on non-rate-limit error', async () => {
      const reposGet = vi.fn().mockRejectedValueOnce(new Error('Not Found'));
      const octokit = { repos: { get: reposGet } } as any;
      const repos = [{ owner: 'o', name: 'gone', full_name: 'o/gone' }];

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const results = await enrichBatch(octokit, repos, { delayMs: 0 });

      expect(results.size).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('o/gone'));
      consoleSpy.mockRestore();
    });

    it('warns on rate limit without reset header', async () => {
      const reposGet = vi.fn().mockRejectedValueOnce(
        Object.assign(new Error('rate limited'), { status: 429 }),
      );
      const octokit = { repos: { get: reposGet } } as any;
      const repos = [{ owner: 'o', name: 'a', full_name: 'o/a' }];

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const results = await enrichBatch(octokit, repos, { delayMs: 0 });

      expect(results.size).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('delays between repos when delayMs > 0', async () => {
      const octokit = makeMockOctokit();
      const repos = [
        { owner: 'o', name: 'a', full_name: 'o/a' },
        { owner: 'o', name: 'b', full_name: 'o/b' },
      ];

      const promise = enrichBatch(octokit, repos, { delayMs: 100 });
      // First repo resolves immediately, then 100ms delay before second
      await vi.advanceTimersByTimeAsync(200);
      const results = await promise;

      expect(results.size).toBe(2);
    });
  });
});
