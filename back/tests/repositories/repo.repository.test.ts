import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTransaction = vi.fn();
const mockDbFn = Object.assign(vi.fn(), { transaction: mockTransaction });
const mockGetDb = vi.fn(() => mockDbFn);
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: (...args: any[]) => mockGetDb(...args),
}));

import { createNeonClient } from '@back/infrastructure/storage/sql/neon-client';
import * as repoRepo from '@back/infrastructure/storage/sql/repo.repository';

const env: any = { DATABASE_URL: 'postgresql://test' };
const db = createNeonClient(env);

describe('repo.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockTransaction.mockReset();
    mockDbFn.mockReset();
    Object.assign(mockDbFn, { transaction: mockTransaction });
  });

  // ── Mutations ─────────────────────────────────

  describe('deleteRepo', () => {
    it('deletes a repo by full_name', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.deleteRepo(db, 'owner/repo');
      expect(mockQuery.mock.calls[0][1]).toContain('DELETE');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo']);
    });
  });

  describe('updateArchived', () => {
    it('sets is_archived to true', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.updateArchived(db, 'owner/repo');
      expect(mockQuery.mock.calls[0][1]).toContain('is_archived = true');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo']);
    });
  });

  describe('updateStatus', () => {
    it('updates local_status', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.updateStatus(db, 'owner/repo', 'active');
      expect(mockQuery.mock.calls[0][2]).toEqual(['active', 'owner/repo']);
    });
  });

  describe('updatePriority', () => {
    it('updates priority', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.updatePriority(db, 'owner/repo', 'high');
      expect(mockQuery.mock.calls[0][2]).toEqual(['high', 'owner/repo']);
    });
  });

  describe('addBlocker', () => {
    it('appends blocker to array', async () => {
      mockQueryOne.mockResolvedValueOnce({ blockers: ['old'] });
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.addBlocker(db, 'owner/repo', 'no-ci');
      expect(mockQuery.mock.calls[0][1]).toContain('UPDATE repos SET blockers');
      expect(mockQuery.mock.calls[0][2]).toEqual([['old', 'no-ci'], 'owner/repo']);
    });
  });

  describe('removeBlocker', () => {
    it('removes blocker from array', async () => {
      mockQueryOne.mockResolvedValueOnce({ blockers: ['no-ci', 'other'] });
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.removeBlocker(db, 'owner/repo', 'no-ci');
      expect(mockQuery.mock.calls[0][2]).toEqual([['other'], 'owner/repo']);
    });
  });

  // ── Deleted / Purge ───────────────────────────

  describe('listDeleted', () => {
    it('returns deleted repos', async () => {
      mockQuery.mockResolvedValueOnce([{ full_name: 'old/repo' }]);
      const result = await repoRepo.listDeleted(db);
      expect(result).toEqual([{ full_name: 'old/repo' }]);
      expect(mockQuery.mock.calls[0][1]).toContain('is_deleted = true');
    });
  });

  describe('purgeDeleted', () => {
    it('purges a specific deleted repo', async () => {
      mockQuery.mockResolvedValueOnce([{ full_name: 'old/repo' }]);
      await repoRepo.purgeDeleted(db, 'old/repo');
      expect(mockQuery.mock.calls[0][1]).toContain('full_name = $1');
      expect(mockQuery.mock.calls[0][2]).toEqual(['old/repo']);
    });

    it('purges all deleted repos when no fullName', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await repoRepo.purgeDeleted(db);
      expect(mockQuery.mock.calls[0][1]).toContain('is_deleted = true');
      expect(mockQuery.mock.calls[0][2]).toEqual([]);
    });
  });

  // ── Validation / Allowed ──────────────────────

  describe('getRepoForValidation', () => {
    it('returns priority, is_archived, is_deleted', async () => {
      mockQueryOne.mockResolvedValueOnce({ priority: 'high', is_archived: false, is_deleted: false });
      const result = await repoRepo.getRepoForValidation(db, 'owner/repo');
      expect(result).toEqual({ priority: 'high', is_archived: false, is_deleted: false });
    });
  });

  describe('listAllowed', () => {
    it('returns high priority non-archived non-deleted repos', async () => {
      mockQuery.mockResolvedValueOnce([{ full_name: 'owner/important' }]);
      const result = await repoRepo.listAllowed(db);
      expect(result).toEqual([{ full_name: 'owner/important' }]);
      expect(mockQuery.mock.calls[0][1]).toContain("priority = 'high'");
    });
  });

  // ── Stats ─────────────────────────────────────

  describe('getStats', () => {
    it('returns repo stats', async () => {
      mockQuery.mockResolvedValueOnce([{
        total: '50', with_ci: '40', with_tests: '35',
        archived: '5', deleted: '3', paused: '2',
      }]);
      const result = await repoRepo.getStats(db);
      expect(result).toEqual({ total: 50, with_ci: 40, with_tests: 35, archived: 5, deleted: 3, paused: 2 });
    });
  });

  // ── Cache status ──────────────────────────────

  describe('getCacheStatus', () => {
    it('returns cache count and latest', async () => {
      mockQueryOne.mockResolvedValueOnce({ count: '93', latest: '2026-03-01T00:00:00Z' });
      const result = await repoRepo.getCacheStatus(db);
      expect(result).toEqual({ count: 93, latest: '2026-03-01T00:00:00Z' });
    });
  });

  // ── Refresh from GitHub ───────────────────────

  describe('refreshFromGitHub', () => {
    it('upserts repos and returns removed/restored', async () => {
      // Transaction returns [upsert, softDelete, restore]
      mockTransaction.mockResolvedValueOnce([
        [], // upsert result
        [{ full_name: 'old/gone' }], // soft-deleted
        [{ full_name: 'old/restored' }], // restored
      ]);

      const repos = [
        {
          full_name: 'owner/repo', owner: 'owner', name: 'repo',
          description: 'test', is_private: false, is_archived: false,
          language: 'TypeScript', default_branch: 'main',
          stars: 10, forks: 2, watchers: 5, open_issues: 1,
          last_commit_at: null, repo_created_at: null, repo_updated_at: null,
          repo_size_kb: 1024, topics: ['ts'], license_key: 'mit', license_name: 'MIT',
          homepage: null, is_fork: false, parent_repo: null,
          has_issues: true, has_projects: true, has_wiki: true,
          has_pages: false, has_discussions: false,
          subscribers_count: 3, is_template: false,
        },
      ];

      const result = await repoRepo.refreshFromGitHub(db, repos);

      expect(result.removedRepos).toEqual(['old/gone']);
      expect(result.restoredRepos).toEqual(['old/restored']);
      expect(mockGetDb).toHaveBeenCalled();
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('handles multiple repos', async () => {
      mockTransaction.mockResolvedValueOnce([[], [], []]);

      const repos = [
        { full_name: 'o/a', owner: 'o', name: 'a', default_branch: 'main' },
        { full_name: 'o/b', owner: 'o', name: 'b', default_branch: 'main' },
      ];

      const result = await repoRepo.refreshFromGitHub(db, repos);
      expect(result.removedRepos).toEqual([]);
      expect(result.restoredRepos).toEqual([]);
    });
  });
});
