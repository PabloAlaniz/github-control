import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
vi.mock('@back/infrastructure/storage/sql/neon', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  getDb: vi.fn(),
}));

import { createNeonClient } from '@back/infrastructure/storage/sql/neon-client';
import * as appRepo from '@back/infrastructure/storage/sql/app.repository';

const env: any = { DATABASE_URL: 'postgresql://test' };
const db = createNeonClient(env);

describe('app.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQueryOne.mockReset();
  });

  describe('listApps', () => {
    it('lists all apps without filter', async () => {
      mockQuery.mockResolvedValueOnce([{ slug: 'app1' }]);
      const result = await appRepo.listApps(db);
      expect(result).toEqual([{ slug: 'app1' }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][1]).not.toContain('WHERE');
    });

    it('filters by repo when provided', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await appRepo.listApps(db, 'owner/repo');
      expect(mockQuery.mock.calls[0][1]).toContain('WHERE');
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo']);
    });
  });

  describe('getApp', () => {
    it('returns app by slug', async () => {
      mockQueryOne.mockResolvedValueOnce({ slug: 'my-app', app_name: 'My App' });
      const result = await appRepo.getApp(db, 'my-app');
      expect(result).toEqual({ slug: 'my-app', app_name: 'My App' });
      expect(mockQueryOne.mock.calls[0][2]).toEqual(['my-app']);
    });
  });

  describe('getAppBasic', () => {
    it('returns basic app fields', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 1, repo_full_name: 'o/r', app_path: 'apps/web', app_name: 'web' });
      const result = await appRepo.getAppBasic(db, 'slug');
      expect(result?.id).toBe(1);
      expect(mockQueryOne.mock.calls[0][2]).toEqual(['slug']);
    });
  });

  describe('listAppsByRepo', () => {
    it('returns apps for a repo', async () => {
      mockQuery.mockResolvedValueOnce([{ slug: 'app1' }, { slug: 'app2' }]);
      const result = await appRepo.listAppsByRepo(db, 'owner/repo');
      expect(result).toHaveLength(2);
      expect(mockQuery.mock.calls[0][2]).toEqual(['owner/repo']);
    });
  });

  describe('upsertApp', () => {
    it('inserts or updates an app', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 5, slug: 'o-r-web' });
      const result = await appRepo.upsertApp(db, {
        repo_full_name: 'owner/repo', app_path: 'apps/web', app_name: 'web',
        slug: 'o-r-web', stack: 'node', detection_source: 'pnpm-workspace',
      });
      expect(result?.id).toBe(5);
      expect(mockQueryOne.mock.calls[0][1]).toContain('ON CONFLICT');
      expect(mockQueryOne.mock.calls[0][2]).toEqual([
        'owner/repo', 'apps/web', 'web', 'o-r-web', 'node', 'pnpm-workspace',
      ]);
    });
  });

  describe('updateApp', () => {
    it('updates app fields', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await appRepo.updateApp(db, 'my-slug', {
        app_name: 'Updated', stack: 'python',
        has_ci: true, has_tests: false, has_readme: true,
        readme_lines: 50, loc: 1000, file_count: 20, docs_quality: 'good',
      });
      expect(mockQuery.mock.calls[0][1]).toContain('UPDATE repo_apps');
      expect(mockQuery.mock.calls[0][2]).toContain('my-slug');
    });
  });

  describe('deleteApp', () => {
    it('deletes an app by slug', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await appRepo.deleteApp(db, 'my-slug');
      expect(mockQuery.mock.calls[0][1]).toContain('DELETE');
      expect(mockQuery.mock.calls[0][2]).toEqual(['my-slug']);
    });
  });

  describe('getAppForDelete', () => {
    it('returns app id and name for delete confirmation', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 3, app_name: 'web' });
      const result = await appRepo.getAppForDelete(db, 'slug');
      expect(result).toEqual({ id: 3, app_name: 'web' });
    });
  });

  describe('updateAppHealth', () => {
    const health = {
      hasCi: true, hasTests: true, hasReadme: true, readmeLines: 100,
      loc: 5000, fileCount: 50, stack: 'node', docsQuality: 'good',
    };

    it('updates health with testing metadata', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const testing = {
        hasUnitTests: true, hasIntegrationTests: false, hasE2eTests: true,
        hasLintConfig: true, hasTypeChecking: true, hasSecurityScan: false, hasPerfTests: false,
        testFramework: 'vitest', e2eFramework: 'playwright', lintTool: 'eslint',
      };
      await appRepo.updateAppHealth(db, 'my-slug', health, testing);
      // With testing param → 19 SQL params
      expect(mockQuery.mock.calls[0][2]).toHaveLength(19);
      expect(mockQuery.mock.calls[0][2][18]).toBe('my-slug');
    });

    it('updates health without testing metadata', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await appRepo.updateAppHealth(db, 'my-slug', health);
      // Without testing param → 9 SQL params
      expect(mockQuery.mock.calls[0][2]).toHaveLength(9);
      expect(mockQuery.mock.calls[0][2][8]).toBe('my-slug');
    });
  });
});
