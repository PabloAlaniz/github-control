import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockEnv } from '../../helpers';

const mockGetAuthenticated = vi.fn();
const mockPaginateIterator = vi.fn();
const mockReposGet = vi.fn();
const mockGetReadme = vi.fn();
const mockRepoUpdate = vi.fn();
const mockSearchIssues = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    users: { getAuthenticated: mockGetAuthenticated },
    repos: {
      get: mockReposGet,
      getReadme: mockGetReadme,
      update: mockRepoUpdate,
      listForAuthenticatedUser: vi.fn(),
      listForOrg: vi.fn(),
    },
    search: { issuesAndPullRequests: mockSearchIssues },
    paginate: { iterator: mockPaginateIterator },
  }; }),
}));

import {
  getAuthenticatedUser,
  getReposWithMetrics,
  getRepoDetails,
  getRepoReadme,
  archiveRepo,
  getAllOpenPRs,
} from '@back/lib/github/repos';

function makeRepo(name: string, overrides?: Record<string, any>) {
  return {
    full_name: `owner/${name}`,
    owner: { login: 'owner' },
    name,
    description: `Repo ${name}`,
    private: false,
    archived: false,
    language: 'TypeScript',
    default_branch: 'main',
    stargazers_count: 10,
    forks_count: 2,
    watchers_count: 5,
    subscribers_count: 3,
    open_issues_count: 1,
    pushed_at: '2026-03-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    size: 1024,
    topics: ['ts'],
    license: { key: 'mit', name: 'MIT' },
    homepage: null,
    fork: false,
    parent: null,
    has_issues: true,
    has_projects: true,
    has_wiki: true,
    has_pages: false,
    has_discussions: false,
    is_template: false,
    ...overrides,
  };
}

describe('github/repos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAuthenticatedUser', () => {
    it('returns authenticated user data', async () => {
      mockGetAuthenticated.mockResolvedValueOnce({ data: { login: 'user', id: 1 } });
      const result = await getAuthenticatedUser(mockEnv as any);
      expect(result.login).toBe('user');
    });
  });

  describe('getReposWithMetrics', () => {
    it('returns repos from user and org', async () => {
      // User repos
      const userRepos = [makeRepo('repo-a'), makeRepo('repo-b')];
      // Org repos
      const orgRepos = [makeRepo('org-repo')];

      mockPaginateIterator
        .mockReturnValueOnce((async function* () {
          yield { data: userRepos };
        })())
        .mockReturnValueOnce((async function* () {
          yield { data: orgRepos };
        })());

      const result = await getReposWithMetrics({ ...mockEnv, GITHUB_ORGS: 'acme-org' } as any);

      expect(result).toHaveLength(3);
      expect(result[0].full_name).toBe('owner/repo-a');
      expect(result[0].stars).toBe(10);
      expect(result[0].license_key).toBe('mit');
    });

    it('deduplicates repos between user and org', async () => {
      const sharedRepo = makeRepo('shared');

      mockPaginateIterator
        .mockReturnValueOnce((async function* () {
          yield { data: [sharedRepo] };
        })())
        .mockReturnValueOnce((async function* () {
          yield { data: [sharedRepo] }; // same repo in org
        })());

      const result = await getReposWithMetrics({ ...mockEnv, GITHUB_ORGS: 'acme-org' } as any);

      expect(result).toHaveLength(1);
    });

    it('handles org fetch error gracefully', async () => {
      mockPaginateIterator
        .mockReturnValueOnce((async function* () {
          yield { data: [makeRepo('repo-a')] };
        })())
        .mockReturnValueOnce((async function* () {
          throw new Error('Org access denied');
        })());

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await getReposWithMetrics({ ...mockEnv, GITHUB_ORGS: 'acme-org' } as any);

      expect(result).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('acme-org'));
      consoleSpy.mockRestore();
    });

    it('maps all repo fields correctly', async () => {
      const repo = makeRepo('full', {
        private: true,
        archived: true,
        fork: true,
        parent: { full_name: 'upstream/full' },
        homepage: 'https://example.com',
        is_template: true,
      });

      mockPaginateIterator
        .mockReturnValueOnce((async function* () {
          yield { data: [repo] };
        })())
        .mockReturnValueOnce((async function* () {
          yield { data: [] };
        })());

      const result = await getReposWithMetrics({ ...mockEnv, GITHUB_ORGS: 'acme-org' } as any);

      expect(result[0].is_private).toBe(true);
      expect(result[0].is_archived).toBe(true);
      expect(result[0].is_fork).toBe(true);
      expect(result[0].parent_repo).toBe('upstream/full');
      expect(result[0].homepage).toBe('https://example.com');
      expect(result[0].is_template).toBe(true);
    });

    it('handles null license and topics', async () => {
      const repo = makeRepo('plain', { license: null, topics: null });

      mockPaginateIterator
        .mockReturnValueOnce((async function* () {
          yield { data: [repo] };
        })())
        .mockReturnValueOnce((async function* () {
          yield { data: [] };
        })());

      const result = await getReposWithMetrics({ ...mockEnv, GITHUB_ORGS: 'acme-org' } as any);

      expect(result[0].license_key).toBeNull();
      expect(result[0].topics).toEqual([]);
    });
  });

  describe('getRepoDetails', () => {
    it('returns repo data', async () => {
      mockReposGet.mockResolvedValueOnce({ data: { full_name: 'owner/repo', size: 1024 } });
      const result = await getRepoDetails(mockEnv as any, 'owner', 'repo');
      expect(result.full_name).toBe('owner/repo');
    });
  });

  describe('getRepoReadme', () => {
    it('returns decoded README content', async () => {
      const content = Buffer.from('# Hello\nWorld').toString('base64');
      mockGetReadme.mockResolvedValueOnce({ data: { content, sha: 'abc' } });

      const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

      expect(result?.content).toBe('# Hello\nWorld');
      expect(result?.sha).toBe('abc');
    });

    it('returns null for 404', async () => {
      const err: any = new Error('Not found');
      err.status = 404;
      mockGetReadme.mockRejectedValueOnce(err);

      const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

      expect(result).toBeNull();
    });

    it('rethrows non-404 errors', async () => {
      const err: any = new Error('Server error');
      err.status = 500;
      mockGetReadme.mockRejectedValueOnce(err);

      await expect(getRepoReadme(mockEnv as any, 'owner', 'repo')).rejects.toThrow('Server error');
    });

    it('returns null when content is empty', async () => {
      mockGetReadme.mockResolvedValueOnce({ data: { content: null, sha: 'abc' } });

      const result = await getRepoReadme(mockEnv as any, 'owner', 'repo');

      expect(result).toBeNull();
    });
  });

  describe('archiveRepo', () => {
    it('calls repos.update with archived=true', async () => {
      mockRepoUpdate.mockResolvedValueOnce({});
      await archiveRepo(mockEnv as any, 'owner', 'repo');
      expect(mockRepoUpdate).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo', archived: true });
    });
  });

  describe('getAllOpenPRs', () => {
    it('returns open PRs', async () => {
      mockSearchIssues.mockResolvedValueOnce({
        data: { items: [{ title: 'Fix bug', number: 1 }] },
      });

      const result = await getAllOpenPRs(mockEnv as any);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Fix bug');
    });
  });
});
