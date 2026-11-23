/**
 * Storage adapter contract.
 *
 * One suite, run unchanged against every adapter. An adapter is correct when
 * it passes this file; behaviour that is not asserted here is not part of the
 * contract. Results are compared after a JSON round-trip, i.e. exactly as the
 * HTTP API would serialize them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Storage } from '@back/application/ports/storage';
import type { SnapshotInput } from '@back/lib/metrics/types';

export interface StorageHarness {
  /**
   * A storage holding nothing but the given metrics-history records (which
   * need arbitrary dates, something the ports cannot write). Called before
   * every test.
   */
  fresh(snapshots?: Record<string, unknown>[]): Promise<Storage>;
}

export const json = <T>(value: T): any => JSON.parse(JSON.stringify(value));

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const isIsoTimestamp = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

/** A repo as the GitHub sync hands it to the store. */
export function ghRepo(name: string, extra: Record<string, unknown> = {}) {
  return {
    full_name: `acme/${name}`, owner: 'acme', name,
    description: `${name} description`, is_private: false, is_archived: false,
    language: 'TypeScript', default_branch: 'main', stars: 1, forks: 0, watchers: 1, open_issues: 0,
    repo_updated_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function snapshotInput(repoId: number, fullName: string, extra: Partial<SnapshotInput['code']> = {}): SnapshotInput {
  return {
    repoId, fullName,
    code: { sizeKb: 100, fileCount: 10, loc: 1000, ...extra },
    github: { stars: 5, forks: 1, watchers: 2, subscribersCount: 2, openIssues: 3 },
    health: {
      hasCi: true, hasTests: false, hasReadme: true, readmeLines: 40,
      hasGitignore: true, hasRoadmap: false, docsFileCount: 2, docsQuality: 'good',
    },
    meta: {
      language: 'TypeScript', isPrivate: false, isArchived: false,
      isFork: false, isTemplate: false, defaultBranch: 'main',
    },
  };
}

const HEALTH = {
  hasCi: true, hasTests: true, hasReadme: true, hasGitignore: true, readmeLines: 120,
  hasRoadmap: false, docsFileCount: 3, hasUnitTests: true, hasIntegrationTests: false,
  hasE2eTests: false, hasLintConfig: true, hasTypeChecking: true, hasSecurityScan: false,
  hasPerfTests: false, testFramework: 'vitest', e2eFramework: null, lintTool: 'eslint',
};

export function describeStorageContract(name: string, harness: StorageHarness) {
  describe(`storage contract: ${name}`, () => {
    let s: Storage;

    beforeEach(async () => {
      s = await harness.fresh();
    });

    const names = (rows: any[]) => rows.map((r) => r.full_name);

    // ── Repos ─────────────────────────────────────────
    describe('repos', () => {
      it('inserts repos from GitHub with complete records and defaults', async () => {
        await s.repos.refreshFromGitHub([ghRepo('api', { topics: ['a', 'b'] })]);
        const repo = json(await s.repos.getRepo('acme/api'));

        expect(repo).toMatchObject({
          full_name: 'acme/api', owner: 'acme', name: 'api', language: 'TypeScript',
          stars: 1, topics: ['a', 'b'], groups: [], blockers: [], production_urls: {},
          priority: null, local_status: null, is_deleted: false, is_archived: false,
          has_ci: null, summary: null, repo_updated_at: '2026-01-01T00:00:00.000Z',
        });
        expect(typeof repo.id).toBe('number');
        expect(isIsoTimestamp(repo.created_at)).toBe(true);
        expect(isIsoTimestamp(repo.github_cached_at)).toBe(true);
        expect(await s.repos.getRepo('acme/missing')).toBeNull();
      });

      it('lists newest first with unset dates last, and hides inactive repos by default', async () => {
        await s.repos.refreshFromGitHub([
          ghRepo('old', { repo_updated_at: '2025-01-01T00:00:00Z' }),
          ghRepo('new', { repo_updated_at: '2026-06-01T00:00:00Z' }),
          ghRepo('undated', { repo_updated_at: null }),
          ghRepo('archived', { is_archived: true }),
          ghRepo('paused'),
        ]);
        await s.repos.updatePriority('acme/paused', 'paused');

        expect(names(await s.repos.listRepos())).toEqual(['acme/new', 'acme/old', 'acme/undated']);
        expect(names(await s.repos.listRepos({ includeArchived: true, includePaused: true })).sort()).toEqual(
          ['acme/archived', 'acme/new', 'acme/old', 'acme/paused', 'acme/undated'],
        );
      });

      it('soft-deletes repos missing from GitHub, restores them, and purges on demand', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b'), ghRepo('c')]);

        const gone = await s.repos.refreshFromGitHub([ghRepo('a')]);
        expect(gone.removedRepos.sort()).toEqual(['acme/b', 'acme/c']);
        expect(gone.restoredRepos).toEqual([]);
        expect(names(await s.repos.listRepos())).toEqual(['acme/a']);
        expect(names(await s.repos.listRepos({ includeDeleted: true })).sort()).toEqual(['acme/a', 'acme/b', 'acme/c']);

        const deleted = json(await s.repos.listDeleted());
        expect(names(deleted).sort()).toEqual(['acme/b', 'acme/c']);
        expect(Object.keys(deleted[0]).sort()).toEqual(
          ['deletion_detected_at', 'description', 'full_name', 'name', 'owner', 'repo_updated_at'],
        );
        expect(isIsoTimestamp(deleted[0].deletion_detected_at)).toBe(true);

        const back = await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b')]);
        expect(back).toEqual({ removedRepos: [], restoredRepos: ['acme/b'] });

        expect(await s.repos.purgeDeleted('acme/a')).toEqual([]);
        expect(await s.repos.purgeDeleted()).toEqual([{ full_name: 'acme/c' }]);
        expect(await s.repos.getRepo('acme/c')).toBeNull();
      });

      it('rejects a refresh with no repos', async () => {
        await expect(s.repos.refreshFromGitHub([])).rejects.toThrow();
      });

      it('keeps user-owned fields when a repo is refreshed', async () => {
        await s.repos.refreshFromGitHub([ghRepo('api')]);
        await s.repos.updatePriority('acme/api', 'high');
        await s.meta.patchRepoMeta('acme/api', { notes: 'keep me' });

        await s.repos.refreshFromGitHub([ghRepo('api', { stars: 42, description: 'changed' })]);

        expect(json(await s.repos.getRepo('acme/api'))).toMatchObject({
          stars: 42, description: 'changed', priority: 'high', notes: 'keep me',
        });
      });

      it('updates status, priority, archived flag and blockers', async () => {
        await s.repos.refreshFromGitHub([ghRepo('api')]);
        await s.repos.updateStatus('acme/api', 'reviewed');
        await s.repos.updatePriority('acme/api', 'medium');
        await s.repos.addBlocker('acme/api', 'waiting on design');
        await s.repos.addBlocker('acme/api', 'no budget');
        await s.repos.removeBlocker('acme/api', 'waiting on design');
        await s.repos.updateArchived('acme/api');

        expect(json(await s.repos.getRepo('acme/api'))).toMatchObject({
          local_status: 'reviewed', priority: 'medium', blockers: ['no budget'], is_archived: true,
        });
        await expect(s.repos.updatePriority('acme/api', 'urgent')).rejects.toThrow();
        await expect(s.repos.updateStatus('acme/missing', 'reviewed')).resolves.toBeUndefined();
      });

      it('filters by flags, stack and priority', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b'), ghRepo('c', { is_archived: true }), ghRepo('d')]);
        await s.meta.patchRepoMeta('acme/a', { has_ci: true, stack: 'node', priority: 'high' });
        await s.meta.patchRepoMeta('acme/b', { has_ci: false, stack: 'python' });
        await s.repos.updatePriority('acme/d', 'paused');

        expect(names(await s.repos.filterRepos({})).sort()).toEqual(['acme/a', 'acme/b']);
        expect(names(await s.repos.filterRepos({ has_ci: 'true' }))).toEqual(['acme/a']);
        expect(names(await s.repos.filterRepos({ has_ci: 'false' }))).toEqual(['acme/b']);
        expect(names(await s.repos.filterRepos({ stack: 'python' }))).toEqual(['acme/b']);
        expect(names(await s.repos.filterRepos({ priority: 'high' }))).toEqual(['acme/a']);
        expect(names(await s.repos.filterRepos({ archived: 'true' }))).toEqual(['acme/c']);
        expect(names(await s.repos.filterRepos({ paused: 'true' }))).toEqual(['acme/d']);
        expect(names(await s.repos.filterRepos({ archived: 'all', paused: 'all' })).sort()).toEqual(
          ['acme/a', 'acme/b', 'acme/c', 'acme/d'],
        );
      });

      it('answers validation, allow-list, stats and cache status', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b'), ghRepo('c', { is_archived: true }), ghRepo('d')]);
        await s.repos.updatePriority('acme/a', 'high');
        await s.repos.updatePriority('acme/c', 'high');
        await s.repos.updatePriority('acme/d', 'paused');
        await s.meta.patchRepoMeta('acme/a', { has_ci: true, has_tests: true });
        await s.meta.patchRepoMeta('acme/b', { has_ci: true });

        expect(await s.repos.listAllowed()).toEqual([{ full_name: 'acme/a' }]);
        expect(json(await s.repos.getRepoForValidation('acme/c'))).toEqual({
          priority: 'high', is_archived: true, is_deleted: false,
        });
        expect(await s.repos.getRepoForValidation('acme/missing')).toBeNull();
        expect(await s.repos.getStats()).toEqual({
          total: 2, with_ci: 2, with_tests: 1, archived: 1, deleted: 0, paused: 1,
        });

        const cache = json(await s.repos.getCacheStatus());
        expect(cache.count).toBe(4);
        expect(isIsoTimestamp(cache.latest)).toBe(true);
      });

      it('reports an empty cache', async () => {
        expect(json(await s.repos.getCacheStatus())).toEqual({ count: 0, latest: null });
        expect(await s.repos.getStats()).toEqual({
          total: 0, with_ci: 0, with_tests: 0, archived: 0, deleted: 0, paused: 0,
        });
      });
    });

    // ── Groups ────────────────────────────────────────
    describe('groups', () => {
      it('creates, lists by name and counts only active repos', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b', { is_archived: true })]);
        const web = await s.groups.createGroup('web', 'web apps', 'frontends', '#ff0000');
        await s.groups.createGroup('api', 'apis');
        const a = await s.groups.getRepoId('acme/a');
        const b = await s.groups.getRepoId('acme/b');
        await s.groups.addRepoToGroup(a!.id, web!.id);
        await s.groups.addRepoToGroup(a!.id, web!.id); // idempotent
        await s.groups.addRepoToGroup(b!.id, web!.id);

        const groups = json(await s.groups.listGroups());
        expect(groups.map((g: any) => [g.slug, g.name, g.color, g.repo_count])).toEqual([
          ['api', 'apis', '#6366f1', 0],
          ['web', 'web apps', '#ff0000', 1],
        ]);
        expect(json(await s.repos.getRepo('acme/a')).groups).toEqual(['web']);
        expect(await s.groups.listAllRepoGroupEdges()).toEqual([
          { repo_full_name: 'acme/a', group_slug: 'web' },
          { repo_full_name: 'acme/b', group_slug: 'web' },
        ]);
        expect(await s.groups.getRepoId('acme/missing')).toBeNull();
      });

      it('rejects duplicate slugs and memberships of unknown repos or groups', async () => {
        await s.groups.createGroup('web', 'web');
        await expect(s.groups.createGroup('web', 'again')).rejects.toThrow();
        await expect(s.groups.addRepoToGroup(999, 999)).rejects.toThrow();
      });

      it('updates, upserts by slug and deletes with its memberships', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        const web = await s.groups.createGroup('web', 'web');
        const a = await s.groups.getRepoId('acme/a');
        await s.groups.addRepoToGroup(a!.id, web!.id);

        await s.groups.updateGroup(web!.id, 'frontend', 'frontend', 'ui', '#000000');
        const same = await s.groups.upsertGroupBySlug('frontend', 'front end', null, null);
        const fresh = await s.groups.upsertGroupBySlug('infra', 'infra', 'ops', '#111111');
        expect(same!.id).toBe(web!.id);
        expect(fresh!.id).not.toBe(web!.id);
        expect(json(await s.groups.listGroups()).map((g: any) => [g.slug, g.name, g.description, g.color])).toEqual([
          ['frontend', 'front end', null, '#6366f1'],
          ['infra', 'infra', 'ops', '#111111'],
        ]);

        await s.groups.removeRepoFromGroup(a!.id, web!.id);
        expect(await s.groups.listAllRepoGroupEdges()).toEqual([]);
        await s.groups.addRepoToGroup(a!.id, web!.id);
        await s.groups.deleteGroup(web!.id);
        expect(await s.groups.listAllRepoGroupEdges()).toEqual([]);
        expect(json(await s.repos.getRepo('acme/a')).groups).toEqual([]);
      });

      it('drops memberships when a repo is deleted', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        const web = await s.groups.createGroup('web', 'web');
        await s.groups.addRepoToGroup((await s.groups.getRepoId('acme/a'))!.id, web!.id);
        await s.repos.deleteRepo('acme/a');
        expect(await s.groups.listAllRepoGroupEdges()).toEqual([]);
        expect(await s.repos.getRepo('acme/a')).toBeNull();
      });
    });

    // ── Meta ──────────────────────────────────────────
    describe('meta', () => {
      it('patches only patchable fields, including lists and objects', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);

        expect(await s.meta.patchRepoMeta('acme/a', {
          priority: 'high', next_action: 'ship', client: 'acme', notes: 'n',
          blockers: ['x', 'y'], production_urls: { api: 'https://api.example.com' },
          stars: 999, // not patchable: ignored
        })).toBe(true);
        expect(await s.meta.patchRepoMeta('acme/a', { stars: 999 })).toBe(false);
        expect(await s.meta.patchRepoMeta('acme/missing', { notes: 'n' })).toBe(true);

        expect(json(await s.meta.getRepoMeta('acme/a'))).toEqual({
          priority: 'high', next_action: 'ship', client: 'acme', notes: 'n',
          blockers: ['x', 'y'], production_urls: { api: 'https://api.example.com' },
        });
        expect(json(await s.repos.getRepo('acme/a')).stars).toBe(1);
        expect(await s.meta.getRepoMeta('acme/missing')).toBeNull();
      });

      it('bulk-updates repo fields and rejects unknown fields', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b')]);
        await s.meta.bulkUpdateMeta([
          { full_name: 'acme/a', priority: 'low', loc: 1234 },
          { full_name: 'acme/b', stack: 'go' },
          { full_name: 'acme/missing', stack: 'go' },
        ]);
        expect(json(await s.repos.getRepo('acme/a'))).toMatchObject({ priority: 'low', loc: 1234 });
        expect(json(await s.repos.getRepo('acme/b'))).toMatchObject({ stack: 'go' });
        await expect(
          s.meta.bulkUpdateMeta([{ full_name: 'acme/a', 'stars = 0; --': 1 }]),
        ).rejects.toThrow(/Unknown repo field/);
      });

      it('summarizes active repos per priority and stack', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b'), ghRepo('c'), ghRepo('d', { is_archived: true })]);
        await s.meta.patchRepoMeta('acme/a', { priority: 'high', stack: 'node' });
        await s.meta.patchRepoMeta('acme/b', { priority: 'high', stack: 'go' });
        await s.meta.patchRepoMeta('acme/c', { priority: 'low', stack: 'node' });
        await s.meta.patchRepoMeta('acme/d', { priority: 'high', stack: 'node' });

        expect(json(await s.meta.getMetaSummary())).toEqual({
          priorities: [{ priority: 'high', count: 2 }, { priority: 'low', count: 1 }],
          stacks: [{ stack: 'go', count: 1 }, { stack: 'node', count: 2 }],
        });
      });
    });

    // ── Health, README and summaries ──────────────────
    describe('health', () => {
      it('stores a full health sync', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        await s.health.updateRepoHealth('acme/a', HEALTH, 'node', 'good', {
          size: 512, default_branch: 'trunk', topics: ['cli'],
          license: { key: 'mit', name: 'MIT License' }, homepage: 'https://a.example.com',
          fork: true, parent: { full_name: 'up/a' }, has_issues: true, subscribers_count: 7,
        }, 4321, 55);

        const repo = json(await s.repos.getRepo('acme/a'));
        expect(repo).toMatchObject({
          has_ci: true, has_tests: true, has_readme: true, has_gitignore: true, readme_lines: 120,
          has_roadmap: false, stack: 'node', docs_quality: 'good', docs_file_count: 3,
          repo_size_kb: 512, default_branch: 'trunk', topics: ['cli'],
          license_key: 'mit', license_name: 'MIT License', homepage: 'https://a.example.com',
          is_fork: true, parent_repo: 'up/a', has_issues: true, has_wiki: null,
          subscribers_count: 7, is_template: false,
          has_unit_tests: true, has_lint_config: true, test_framework: 'vitest', e2e_framework: null,
          loc: 4321, file_count: 55, deep_analysis_status: 'completed',
        });
        expect(isIsoTimestamp(repo.last_health_check)).toBe(true);
        expect(isIsoTimestamp(repo.last_docs_check)).toBe(true);
      });

      it('stores CI status and manual health', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        await s.health.updateCiStatus('acme/a', {
          ci_status: 'success', ci_status_url: 'https://ci.example.com/1', ci_status_run_at: '2026-02-03T04:05:06Z',
        });
        await s.health.updateManualHealth('acme/a', { has_ci: true, has_tests: false, test_coverage: 80, stack: 'go' });

        const repo = json(await s.repos.getRepo('acme/a'));
        expect(repo).toMatchObject({
          ci_status: 'success', ci_status_url: 'https://ci.example.com/1',
          ci_status_run_at: '2026-02-03T04:05:06.000Z',
          has_ci: true, has_tests: false, test_coverage: 80, stack: 'go', has_readme: null, readme_lines: null,
        });
        expect(isIsoTimestamp(repo.ci_status_checked_at)).toBe(true);
      });

      it('caches the README and stores manual and AI summaries', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        expect(json(await s.health.getReadmeContent('acme/a'))).toEqual({ readme_content: null });
        expect(await s.health.getReadmeContent('acme/missing')).toBeNull();

        await s.health.cacheReadme('acme/a', '# Title\nbody', 2);
        await s.health.saveSummary('acme/a', { title: 'manual', keyFeatures: ['x'] });
        expect(json(await s.health.getDocs('acme/a'))).toEqual({
          readme_content: '# Title\nbody', summary: { title: 'manual', keyFeatures: ['x'] },
        });
        expect(json(await s.repos.getRepo('acme/a'))).toMatchObject({ has_readme: true, readme_lines: 2 });

        const ai = {
          title: 'ai', source: 'ai', model: 'some-model',
          generated_at: '2026-03-04T05:06:07.000Z', tokens_in: 100, tokens_out: 20,
        };
        await s.health.saveAiSummary('acme/a', ai);
        expect(json(await s.health.getSummary('acme/a'))).toEqual({ summary: ai });
        expect(json(await s.repos.getRepo('acme/a'))).toMatchObject({
          summary_model: 'some-model', summary_tokens_in: 100, summary_tokens_out: 20,
          summary_generated_at: '2026-03-04T05:06:07.000Z',
        });
        expect(await s.health.getSummary('acme/missing')).toBeNull();
        expect(await s.health.getDocs('acme/missing')).toBeNull();
      });
    });

    // ── Apps and coverage ─────────────────────────────
    describe('apps and coverage', () => {
      const app = (appName: string, extra: Record<string, unknown> = {}) => ({
        repo_full_name: 'acme/mono', app_path: `apps/${appName}`, app_name: appName,
        slug: `acme-mono-${appName}`, stack: 'node' as string | null, detection_source: 'manual',
        ...extra,
      });

      it('upserts apps by slug and keeps the stack when the new one is unknown', async () => {
        const first = await s.apps.upsertApp(app('web'));
        const again = await s.apps.upsertApp(app('web', { app_name: 'webapp', stack: null }));
        expect(again).toEqual(first);
        expect(first!.slug).toBe('acme-mono-web');

        expect(json(await s.apps.getApp('acme-mono-web'))).toMatchObject({
          app_name: 'webapp', app_path: 'apps/web', stack: 'node', detection_source: 'manual',
          has_ci: null, coverage_value: null, coverage_commit_sha: null,
        });
        expect(json(await s.apps.getAppBasic('acme-mono-web'))).toEqual({
          id: first!.id, repo_full_name: 'acme/mono', app_path: 'apps/web', app_name: 'webapp',
        });
        expect(json(await s.apps.getAppForDelete('acme-mono-web'))).toEqual({ id: first!.id, app_name: 'webapp' });
        expect(await s.apps.getApp('nope')).toBeNull();
        expect(await s.apps.getAppBasic('nope')).toBeNull();
        expect(await s.apps.getAppForDelete('nope')).toBeNull();
        await expect(s.apps.upsertApp(app('web', { slug: 'other-slug' }))).rejects.toThrow();
      });

      it('lists apps with their coverage report', async () => {
        await s.apps.upsertApp(app('web'));
        await s.apps.upsertApp(app('api'));
        await s.apps.upsertApp(app('cli', { repo_full_name: 'acme/another', slug: 'acme-another-cli' }));
        await s.coverage.upsertCoverage('acme/mono', 'web', 71, 'abc123');
        await s.coverage.upsertCoverage('acme/mono', 'web', 75, 'def456');
        await s.coverage.upsertCoverage('acme/mono', 'default', 60);

        const all = json(await s.apps.listApps());
        expect(all.map((a: any) => [a.repo_full_name, a.app_name, a.coverage_value, a.coverage_commit_sha])).toEqual([
          ['acme/another', 'cli', null, null],
          ['acme/mono', 'api', null, null],
          ['acme/mono', 'web', 75, 'def456'],
        ]);
        expect(json(await s.apps.listApps('acme/mono')).map((a: any) => a.app_name)).toEqual(['api', 'web']);
        expect(json(await s.apps.listAppsByRepo('acme/mono')).map((a: any) => a.slug).sort()).toEqual(
          ['acme-mono-api', 'acme-mono-web'],
        );
        expect(json(await s.repos.listAllAppsEnriched()).map((a: any) => [a.app_name, a.coverage_value])).toEqual([
          ['api', null], ['cli', null], ['web', 75],
        ]);

        const reports = json(await s.coverage.listCoverageReports('acme/mono'));
        expect(reports.map((r: any) => [r.label, r.coverage, r.commit_sha])).toEqual([
          ['default', 60, null], ['web', 75, 'def456'],
        ]);
        expect(isIsoTimestamp(reports[0].reported_at)).toBe(true);
        expect(json(await s.repos.listAllCoverage()).length).toBe(2);
        await expect(s.coverage.upsertCoverage('acme/mono', 'web', 101)).rejects.toThrow();
      });

      it('updates apps field by field, stores health and prunes stale apps', async () => {
        await s.apps.upsertApp(app('web'));
        await s.apps.upsertApp(app('api'));

        await s.apps.updateApp('acme-mono-web', { app_name: 'site', has_ci: false, loc: 10 });
        await s.apps.updateApp('acme-mono-web', { stack: '', has_tests: true });
        expect(json(await s.apps.getApp('acme-mono-web'))).toMatchObject({
          app_name: 'site', stack: 'node', has_ci: false, has_tests: true, loc: 10,
        });

        const health = {
          hasCi: true, hasTests: true, hasReadme: false, readmeLines: 0,
          loc: 500, fileCount: 9, stack: null, docsQuality: 'missing',
        };
        await s.apps.updateAppHealth('acme-mono-web', health);
        await s.apps.updateAppHealth('acme-mono-api', { ...health, stack: 'go' }, {
          hasUnitTests: true, hasIntegrationTests: false, hasE2eTests: true, hasLintConfig: true,
          hasTypeChecking: false, hasSecurityScan: false, hasPerfTests: false,
          testFramework: 'vitest', e2eFramework: 'playwright', lintTool: null,
        });
        const web = json(await s.apps.getApp('acme-mono-web'));
        expect(web).toMatchObject({
          has_ci: true, has_readme: false, loc: 500, file_count: 9, stack: 'node',
          docs_quality: 'missing', has_unit_tests: null,
        });
        expect(isIsoTimestamp(web.last_health_check)).toBe(true);
        expect(json(await s.apps.getApp('acme-mono-api'))).toMatchObject({
          stack: 'go', has_unit_tests: true, has_e2e_tests: true, e2e_framework: 'playwright', lint_tool: null,
        });

        await s.apps.deleteStaleApps('acme/mono', []); // no-op by contract
        expect(json(await s.apps.listApps()).length).toBe(2);
        await s.apps.deleteStaleApps('acme/mono', ['acme-mono-api']);
        expect(json(await s.apps.listApps()).map((a: any) => a.slug)).toEqual(['acme-mono-api']);
        await s.apps.deleteApp('acme-mono-api');
        expect(await s.apps.listApps()).toEqual([]);
      });

      it('mirrors CI coverage onto the repo', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        await s.coverage.updateRepoCoverage('acme/a', 88);
        const repo = json(await s.repos.getRepo('acme/a'));
        expect(repo).toMatchObject({ test_coverage: 88, has_tests: true, coverage_source: 'ci' });
        expect(isIsoTimestamp(repo.coverage_updated_at)).toBe(true);
      });
    });

    // ── Metrics history ───────────────────────────────
    describe('metrics', () => {
      it('writes one snapshot per repo per day', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a')]);
        const { id } = (await s.groups.getRepoId('acme/a'))!;
        expect(await s.metrics.getLatestSnapshotDate()).toBeNull();

        await s.metrics.upsertSnapshot(snapshotInput(id, 'acme/a'));
        await s.metrics.upsertSnapshot(snapshotInput(id, 'acme/a', { loc: 2000 }));

        expect(await s.metrics.getLatestSnapshotDate()).toBe(today());
        expect(json(await s.metrics.getRepoMetrics('acme/a', 30))).toEqual([{
          snapshot_date: today(), repo_size_kb: 100, file_count: 10, loc: 2000,
          stars: 5, forks: 1, watchers: 2, subscribers_count: 2, open_issues: 3,
          has_ci: true, has_tests: false, has_readme: true, readme_lines: 40,
          docs_quality: 'good', docs_file_count: 2,
        }]);
        expect(json(await s.metrics.getSnapshot(today()))).toEqual([expect.objectContaining({
          full_name: 'acme/a', snapshot_date: today(), loc: 2000,
          language: 'TypeScript', is_private: false, is_archived: false,
        })]);
        expect(await s.metrics.getSnapshot('2000-01-01')).toEqual([]);
      });

      const seedHistory = async () => {
        const base = { has_ci: true, has_tests: true, has_readme: true, docs_quality: 'good', is_archived: false };
        const rows: Record<string, unknown>[] = [];
        rows.push({ repo_id: 1, full_name: 'acme/a', snapshot_date: daysAgo(40), loc: 100, stars: 1, open_issues: 5, file_count: 10, ...base });
        rows.push({ repo_id: 1, full_name: 'acme/a', snapshot_date: daysAgo(10), loc: 150, stars: 2, open_issues: 4, file_count: 12, ...base });
        rows.push({ repo_id: 1, full_name: 'acme/a', snapshot_date: today(), loc: 300, stars: 4, open_issues: 1, file_count: 20, ...base });
        rows.push({ repo_id: 2, full_name: 'acme/b', snapshot_date: today(), loc: 50, stars: 0, open_issues: 0, file_count: 5, ...base, has_tests: false, docs_quality: 'missing' });
        rows.push({ repo_id: 3, full_name: 'acme/c', snapshot_date: daysAgo(10), loc: 70, stars: 9, open_issues: 0, file_count: 7, ...base });
        rows.push({ repo_id: 4, full_name: 'acme/arch', snapshot_date: today(), loc: 9999, stars: 0, open_issues: 0, file_count: 1, ...base, is_archived: true });
        s = await harness.fresh(rows);
      };

      it('limits a repo history to the requested window, oldest first', async () => {
        await seedHistory();
        expect(json(await s.metrics.getRepoMetrics('acme/a', 30)).map((m: any) => [m.snapshot_date, m.loc])).toEqual([
          [daysAgo(10), 150], [today(), 300],
        ]);
        expect(json(await s.metrics.getRepoMetrics('acme/a', 90)).length).toBe(3);
      });

      it('aggregates non-archived repos per day with numeric totals', async () => {
        await seedHistory();
        const days = json(await s.metrics.getAggregate(30));
        expect(days.map((d: any) => d.snapshot_date)).toEqual([daysAgo(10), today()]);
        expect(days[1]).toEqual({
          snapshot_date: today(), total_repos: 2, total_loc: 350, total_files: 25, total_size_kb: null,
          total_stars: 4, total_forks: 0, total_open_issues: 1,
          repos_with_ci: 2, repos_with_tests: 1, repos_with_readme: 2,
          repos_docs_excellent: 0, repos_docs_good: 1, repos_docs_needs_work: 0, repos_docs_missing: 1,
        });
      });

      it('computes trends against the latest snapshot at or before the period start', async () => {
        await seedHistory();
        expect(json(await s.metrics.getBulkTrends(30))).toEqual([
          { full_name: 'acme/a', loc_delta: 200, stars_delta: 3, open_issues_delta: -4, current_loc: 300, prev_loc: 100, period_days: 30 },
          { full_name: 'acme/arch', loc_delta: null, stars_delta: null, open_issues_delta: null, current_loc: 9999, prev_loc: null, period_days: 30 },
          { full_name: 'acme/b', loc_delta: null, stars_delta: null, open_issues_delta: null, current_loc: 50, prev_loc: null, period_days: 30 },
          { full_name: 'acme/c', loc_delta: null, stars_delta: null, open_issues_delta: null, current_loc: 70, prev_loc: null, period_days: 30 },
        ]);
      });

      it('compares two dates, flagging new and removed repos, biggest change first', async () => {
        await seedHistory();
        const changes = json(await s.metrics.compareSnapshots(daysAgo(10), today()));
        expect(changes.map((c: any) => [c.full_name, c.loc_delta, c.is_new, c.is_removed])).toEqual([
          ['acme/arch', 9999, true, false],
          ['acme/a', 150, false, false],
          ['acme/c', -70, false, true],
          ['acme/b', 50, true, false],
        ]);
        expect(changes[1]).toEqual({
          full_name: 'acme/a', loc_delta: 150, file_count_delta: 8, repo_size_kb_delta: 0,
          stars_delta: 2, forks_delta: 0, open_issues_delta: -3,
          current_loc: 300, current_file_count: 20, current_stars: 4, from_loc: 150,
          is_new: false, is_removed: false,
        });
      });
    });

    // ── Services ──────────────────────────────────────
    describe('services', () => {
      it('creates, reads and filters services joined with their repo', async () => {
        await s.repos.refreshFromGitHub([ghRepo('api', { language: 'Go' })]);
        await s.meta.patchRepoMeta('acme/api', { stack: 'go' });
        const created = await s.services.createService({
          name: 'api', slug: 'api', url: 'https://api.example.com', provider: 'gcp',
          region: 'us-central1', source_repo_full_name: 'acme/api',
        });
        await s.services.createService({ name: 'web', slug: 'web', provider: 'vercel', env: 'staging' });

        expect(created!.slug).toBe('api');
        expect(json(await s.services.getService('api'))).toMatchObject({
          name: 'api', url: 'https://api.example.com', provider: 'gcp', region: 'us-central1',
          env: 'production', is_active: true, last_check_status: 'unknown', project: null,
          repo_language: 'Go', repo_stack: 'go', repo_description: 'api description',
        });
        expect(json(await s.services.getService('web'))).toMatchObject({
          url: null, repo_language: null, repo_stack: null, repo_description: null,
        });
        expect(await s.services.getService('nope')).toBeNull();
        expect(json(await s.services.getServiceBasic('api'))).toEqual({
          id: created!.id, url: 'https://api.example.com', name: 'api',
        });
        expect(json(await s.services.getServiceForDelete('api'))).toEqual({ id: created!.id, name: 'api' });

        const slugs = async (filters: Parameters<Storage['services']['listServices']>[0]) =>
          json(await s.services.listServices(filters)).map((x: any) => x.slug);
        expect(await slugs({})).toEqual(['api', 'web']);
        expect(await slugs({ provider: 'gcp' })).toEqual(['api']);
        expect(await slugs({ env: 'staging' })).toEqual(['web']);
        expect(await slugs({ sourceRepo: 'acme/api' })).toEqual(['api']);
        expect(await slugs({ isActive: 'false' })).toEqual([]);
        await expect(s.services.createService({ name: 'dup', slug: 'api', provider: 'gcp' })).rejects.toThrow();
      });

      it('updates only the provided fields and records health checks', async () => {
        await s.services.createService({ name: 'api', slug: 'api', url: 'https://api.example.com', provider: 'gcp' });
        await s.services.updateService('api', { description: 'main api', is_active: false, name: '' });
        await s.services.updateHealthCheck('api', 'healthy', 123, 200);

        const service = json(await s.services.getService('api'));
        expect(service).toMatchObject({
          name: 'api', description: 'main api', is_active: false, provider: 'gcp',
          last_check_status: 'healthy', last_check_response_ms: 123, last_check_http_code: 200,
        });
        expect(isIsoTimestamp(service.last_check_at)).toBe(true);
        expect(await s.services.listActiveServices()).toEqual([]);
      });

      it('lists active services with a URL, and by repo', async () => {
        await s.services.createService({ name: 'b', slug: 'b', url: 'https://b.example.com', provider: 'gcp', source_repo_full_name: 'acme/api' });
        await s.services.createService({ name: 'a', slug: 'a', url: 'https://a.example.com', provider: 'gcp', source_repo_full_name: 'acme/api' });
        await s.services.createService({ name: 'nourl', slug: 'nourl', provider: 'gcp', source_repo_full_name: 'acme/api' });
        await s.services.updateService('b', { is_active: false });

        expect(json(await s.services.listActiveServices())).toEqual([
          { slug: 'a', url: 'https://a.example.com', name: 'a' },
        ]);
        expect(json(await s.services.listServicesByRepo('acme/api')).map((x: any) => x.slug)).toEqual(['a', 'nourl']);

        await s.services.deleteService('a');
        expect(await s.services.getService('a')).toBeNull();
      });

      it('derives services from repo homepages', async () => {
        await s.repos.refreshFromGitHub([
          ghRepo('My.App', { homepage: 'my-app-abc.us-central1.run.app' }),
          ghRepo('site', { homepage: 'https://site.pages.dev' }),
          ghRepo('plain', { homepage: 'https://example.com' }),
          ghRepo('none', { homepage: '' }),
          ghRepo('linked', { homepage: 'https://linked.vercel.app' }),
        ]);
        await s.services.createService({ name: 'linked', slug: 'linked-svc', provider: 'vercel', source_repo_full_name: 'acme/linked' });

        expect(await s.services.syncFromRepos()).toEqual({ updatedCount: 1, createdCount: 3 });
        expect(await s.services.syncFromRepos()).toEqual({ updatedCount: 0, createdCount: 0 });

        const services = json(await s.services.listServices({}));
        expect(services.map((x: any) => [x.slug, x.url, x.provider, x.region, x.source_repo_full_name, x.env])).toEqual([
          ['my-app', 'https://my-app-abc.us-central1.run.app', 'gcp', 'us-central1', 'acme/My.App', 'production'],
          ['linked-svc', 'https://linked.vercel.app', 'vercel', null, 'acme/linked', 'production'],
          ['plain', 'https://example.com', 'other', null, 'acme/plain', 'production'],
          ['site', 'https://site.pages.dev', 'cloudflare', null, 'acme/site', 'production'],
        ]);
      });
    });

    // ── Activity log ──────────────────────────────────
    describe('activity', () => {
      const log = (action: string, entityId: string, actorName: string, extra: Record<string, unknown> = {}) =>
        s.activity.logActivity({
          action, entityType: 'repo', entityId, actorType: 'agent', actorName, ...extra,
        });

      it('appends entries and returns them formatted', async () => {
        const entry = json(await log('priority.set', 'acme/a', 'bot', {
          fieldChanged: 'priority', oldValue: null, newValue: 5, metadata: { reason: 'x' },
        }));
        expect(entry).toMatchObject({
          action: 'priority.set', entityType: 'repo', entityId: 'acme/a', fieldChanged: 'priority',
          oldValue: null, newValue: '5', actorType: 'agent', actorName: 'bot', metadata: { reason: 'x' },
        });
        expect(typeof entry.id).toBe('number');
        expect(isIsoTimestamp(entry.createdAt)).toBe(true);
      });

      it('lists newest first with filters and paging', async () => {
        await log('a.one', 'acme/a', 'bot');
        await log('a.two', 'acme/a', 'bot');
        await log('b.one', 'acme/b', 'human');
        await s.activity.logActivity({ action: 'g.one', entityType: 'group', entityId: 'web', actorType: 'human', actorName: 'human' });

        const actions = async (filters: Partial<Parameters<Storage['activity']['listActivities']>[0]>) =>
          json(await s.activity.listActivities({ limit: 50, offset: 0, ...filters })).map((a: any) => a.action);
        expect(await actions({})).toEqual(['g.one', 'b.one', 'a.two', 'a.one']);
        expect(await actions({ limit: 2, offset: 1 })).toEqual(['b.one', 'a.two']);
        expect(await actions({ entityType: 'repo', entityId: 'acme/a' })).toEqual(['a.two', 'a.one']);
        expect(await actions({ actorName: 'human' })).toEqual(['g.one', 'b.one']);
        expect(await actions({ actorName: 'human', actorType: 'human' })).toEqual(['g.one']);
        expect(await actions({ action: 'a.one' })).toEqual(['a.one']);

        const row = json(await s.activity.listActivities({ limit: 1, offset: 0 }))[0];
        expect(Object.keys(row).sort()).toEqual([
          'action', 'actor_name', 'actor_type', 'created_at', 'entity_id', 'entity_type',
          'field_changed', 'id', 'metadata', 'new_value', 'old_value',
        ]);
        expect(json(await s.activity.getActivitiesByEntity('repo', 'acme/a', 1)).map((a: any) => a.action)).toEqual(['a.two']);
      });

      it('counts and aggregates with numbers', async () => {
        await log('a.one', 'acme/a', 'bot');
        await log('a.two', 'acme/a', 'bot');
        await log('b.one', 'acme/b', 'bot');
        await log('c.one', 'acme/c', 'human');

        expect(await s.activity.getActivityCount()).toBe(4);
        expect(await s.activity.getActivityCount('repo', 'acme/a')).toBe(2);
        expect(await s.activity.getActivityCount('group')).toBe(0);

        const actors = json(await s.activity.getStatsByActor());
        expect(actors.map((a: any) => [a.actor_type, a.actor_name, a.total_actions, a.entities_touched])).toEqual([
          ['agent', 'bot', 3, 2], ['agent', 'human', 1, 1],
        ]);
        expect(isIsoTimestamp(actors[0].last_activity)).toBe(true);

        expect(json(await s.activity.getStatsByDay(7))).toEqual([
          { day: today(), actor_type: 'agent', actor_name: 'bot', actions: 3 },
          { day: today(), actor_type: 'agent', actor_name: 'human', actions: 1 },
        ]);
      });
    });

    // ── Traffic history ───────────────────────────────
    describe('traffic', () => {
      const day = (d: string, views: number, clones = 0) => ({
        day: d, views, views_unique: Math.ceil(views / 2), clones, clones_unique: Math.ceil(clones / 2),
      });

      it('keeps per-day counts beyond what GitHub retains, overwriting days seen again', async () => {
        await s.traffic.upsertDaily('acme/a', [day(daysAgo(40), 7), day(daysAgo(3), 10, 4), day(daysAgo(1), 20, 6)]);
        await s.traffic.upsertDaily('acme/a', [day(daysAgo(1), 25, 8), day(today(), 5, 1)]); // yesterday grew
        await s.traffic.upsertDaily('acme/b', [day(daysAgo(1), 100)]);
        await s.traffic.upsertDaily('acme/a', []);

        expect(json(await s.traffic.getDaily('acme/a', 14))).toEqual([
          day(daysAgo(3), 10, 4), day(daysAgo(1), 25, 8), day(today(), 5, 1),
        ]);
        expect(json(await s.traffic.getDaily('acme/a', 90)).length).toBe(4);
        expect(await s.traffic.getDaily('acme/none', 14)).toEqual([]);

        expect(json(await s.traffic.getDailyTotals(14))).toEqual([
          day(daysAgo(3), 10, 4),
          { day: daysAgo(1), views: 125, views_unique: 63, clones: 8, clones_unique: 4 },
          day(today(), 5, 1),
        ]);
        expect(json(await s.traffic.getTotalsByRepo(14))).toEqual([
          { full_name: 'acme/b', views: 100, views_unique: 50, clones: 0, clones_unique: 0 },
          { full_name: 'acme/a', views: 40, views_unique: 21, clones: 13, clones_unique: 7 },
        ]);
        expect(await s.traffic.getTotalsByRepo(0)).toEqual(
          [expect.objectContaining({ full_name: 'acme/a', views: 5 })],
        );
      });

      it('keeps the latest referrers and paths per repo', async () => {
        await s.traffic.replaceSources('acme/a', daysAgo(2), 'referrer', [
          { label: 'old.example', hits: 99, uniques: 9 },
        ]);
        await s.traffic.replaceSources('acme/a', today(), 'referrer', [
          { label: 'news.example', hits: 5, uniques: 4 },
          { label: 'google.com', hits: 30, uniques: 12 },
        ]);
        await s.traffic.replaceSources('acme/a', today(), 'referrer', [
          { label: 'google.com', hits: 31, uniques: 12 },
          { label: 'github.com', hits: 8, uniques: 3 },
        ]);
        await s.traffic.replaceSources('acme/a', today(), 'path', [
          { label: '/acme/a', title: 'acme/a: the project', hits: 50, uniques: 20 },
        ]);

        expect(json(await s.traffic.getSources('acme/a', 'referrer'))).toEqual({
          day: today(),
          sources: [
            { label: 'google.com', title: null, hits: 31, uniques: 12 },
            { label: 'github.com', title: null, hits: 8, uniques: 3 },
          ],
        });
        expect(json(await s.traffic.getSources('acme/a', 'path'))).toEqual({
          day: today(),
          sources: [{ label: '/acme/a', title: 'acme/a: the project', hits: 50, uniques: 20 }],
        });
        expect(json(await s.traffic.getSources('acme/none', 'path'))).toEqual({ day: null, sources: [] });
      });
    });

    // ── Saved views ───────────────────────────────────
    describe('saved views', () => {
      it('creates, lists by name ignoring case, replaces by name and deletes', async () => {
        const stale = await s.savedViews.upsertSavedView('stale', 'stale=1');
        await s.savedViews.upsertSavedView('Prod without CI', 'health=needs-ci&groups=prod');
        await s.savedViews.upsertSavedView('all', '');

        expect(stale).toMatchObject({ id: expect.any(Number), name: 'stale', query: 'stale=1' });
        expect(isIsoTimestamp(stale.created_at)).toBe(true);
        expect(json(await s.savedViews.listSavedViews()).map((v: any) => v.name)).toEqual(['all', 'Prod without CI', 'stale']);

        const replaced = await s.savedViews.upsertSavedView('stale', 'stale=1&vis=private');
        expect(replaced).toMatchObject({ id: stale.id, query: 'stale=1&vis=private' });
        expect(isIsoTimestamp(replaced.updated_at)).toBe(true);
        expect(await s.savedViews.listSavedViews()).toHaveLength(3);

        expect(await s.savedViews.deleteSavedView(stale.id)).toBe(true);
        expect(await s.savedViews.deleteSavedView(stale.id)).toBe(false);
        expect(json(await s.savedViews.listSavedViews()).map((v: any) => v.name)).toEqual(['all', 'Prod without CI']);
      });
    });

    // ── Repo signals ──────────────────────────────────
    describe('signals', () => {
      it('keeps one record per repo and kind, with nested data intact', async () => {
        await s.repos.refreshFromGitHub([ghRepo('a'), ghRepo('b')]);
        const data = { passed: 3, total: 4, checks: [{ key: 'license', passed: false, note: 'has, "quotes"' }], items: [] };

        const stored = await s.signals.upsertSignal('acme/a', 'standards', data);
        expect(json(stored)).toMatchObject({ full_name: 'acme/a', kind: 'standards', data });
        expect(isIsoTimestamp(stored!.checked_at)).toBe(true);

        await s.signals.upsertSignal('acme/a', 'standards', { passed: 4, total: 4 });
        await s.signals.upsertSignal('acme/a', 'ci', { available: false });
        await s.signals.upsertSignal('acme/b', 'standards', { passed: 0, total: 4 });

        expect(json(await s.signals.getRepoSignals('acme/a')).map((r: any) => [r.kind, r.data])).toEqual([
          ['ci', { available: false }],
          ['standards', { passed: 4, total: 4 }],
        ]);
        expect(json(await s.signals.listSignals()).map((r: any) => `${r.full_name}:${r.kind}`)).toEqual([
          'acme/a:ci', 'acme/a:standards', 'acme/b:standards',
        ]);
        expect(json(await s.signals.listSignals('standards')).map((r: any) => r.full_name)).toEqual(['acme/a', 'acme/b']);
        expect(await s.signals.listSignals('none')).toEqual([]);
        expect(await s.signals.getRepoSignals('acme/none')).toEqual([]);
      });

      it('does not store signals for repos it does not know', async () => {
        expect(await s.signals.upsertSignal('acme/ghost', 'standards', { passed: 1 })).toBeNull();
        expect(await s.signals.listSignals()).toEqual([]);
      });
    });

    // ── Service check history ─────────────────────────
    describe('service checks', () => {
      const at = (days: number, hour: number) => `${daysAgo(days)}T${String(hour).padStart(2, '0')}:00:00.000Z`;

      it('aggregates checks per service and day', async () => {
        await s.serviceChecks.recordCheck('api', 'healthy', 100, 200, at(2, 1));
        await s.serviceChecks.recordCheck('api', 'down', null, null, at(2, 2));
        await s.serviceChecks.recordCheck('api', 'degraded', 301, 404, at(2, 3));
        await s.serviceChecks.recordCheck('api', 'healthy', 50, 200, at(1, 1));
        await s.serviceChecks.recordCheck('web', 'down', null, null, at(1, 1));
        await s.serviceChecks.recordCheck('api', 'down', 9, 500, at(40, 1));
        await s.serviceChecks.recordCheck('api', 'healthy', 70, 200); // now

        expect(json(await s.serviceChecks.getDailyUptime(7))).toEqual([
          { slug: 'api', day: daysAgo(2), checks: 3, down: 1, degraded: 1, avg_ms: 201 },
          { slug: 'api', day: daysAgo(1), checks: 1, down: 0, degraded: 0, avg_ms: 50 },
          { slug: 'api', day: today(), checks: 1, down: 0, degraded: 0, avg_ms: 70 },
          { slug: 'web', day: daysAgo(1), checks: 1, down: 1, degraded: 0, avg_ms: null },
        ]);
        expect(json(await s.serviceChecks.getDailyUptime(90)).filter((r: any) => r.slug === 'api')).toHaveLength(4);
      });

      it('counts an incident each time a service goes down, not each failed check', async () => {
        const statuses = ['healthy', 'down', 'down', 'degraded', 'down', 'healthy'];
        for (const [hour, status] of statuses.entries()) {
          await s.serviceChecks.recordCheck('api', status, 10, 200, at(1, hour));
        }
        await s.serviceChecks.recordCheck('web', 'down', null, null, at(3, 5)); // down from its first check
        await s.serviceChecks.recordCheck('web', 'down', null, null, at(3, 6));
        await s.serviceChecks.recordCheck('ok', 'healthy', 10, 200, at(1, 1));

        expect(json(await s.serviceChecks.getIncidents(7))).toEqual([
          { slug: 'api', incidents: 2, last_down_at: at(1, 4) },
          { slug: 'web', incidents: 1, last_down_at: at(3, 6) },
        ]);
        expect(await s.serviceChecks.getIncidents(2)).toEqual([expect.objectContaining({ slug: 'api' })]);
      });

      it('prunes checks older than the retention', async () => {
        await s.serviceChecks.recordCheck('api', 'healthy', 10, 200, at(100, 1));
        await s.serviceChecks.recordCheck('api', 'healthy', 10, 200, at(5, 1));

        await s.serviceChecks.pruneChecks(90);

        expect(json(await s.serviceChecks.getDailyUptime(365)).map((r: any) => r.day)).toEqual([daysAgo(5)]);
      });
    });

    // ── Alerts ────────────────────────────────────────
    describe('alerts', () => {
      const input = (key: string, extra: Record<string, unknown> = {}) => ({
        key, kind: key.split(':')[0], entity: key.split(':')[1], title: `Title of ${key}`,
        detail: { note: 'has, "quotes"', nested: { n: 1 } }, url: null, level: 0, ...extra,
      });

      it('opens, updates and resolves alerts, newest first', async () => {
        const first = await s.alerts.openAlert(input('ci_failing:acme/a', { url: 'https://example.com/run/1' }));
        const second = await s.alerts.openAlert(input('security:acme/b', { level: 2 }));

        expect(json(first)).toMatchObject({
          id: expect.any(Number), key: 'ci_failing:acme/a', kind: 'ci_failing', entity: 'acme/a',
          title: 'Title of ci_failing:acme/a', detail: { note: 'has, "quotes"', nested: { n: 1 } },
          url: 'https://example.com/run/1', level: 0, status: 'open', resolved_at: null,
        });
        expect(isIsoTimestamp(first.opened_at)).toBe(true);
        expect(json(await s.alerts.listAlerts()).map((a: any) => a.id)).toEqual([second.id, first.id]);

        await s.alerts.updateAlert(second.id, { title: 'Worse', detail: { critical: 3 }, url: 'https://example.com/s', level: 3 });
        await s.alerts.resolveAlert(first.id);

        const open = json(await s.alerts.listAlerts({ status: 'open' }));
        expect(open).toEqual([expect.objectContaining({
          id: second.id, title: 'Worse', detail: { critical: 3 }, url: 'https://example.com/s', level: 3,
        })]);
        const [resolved] = await s.alerts.listAlerts({ status: 'resolved' });
        expect(resolved).toMatchObject({ id: first.id, status: 'resolved' });
        expect(isIsoTimestamp(resolved.resolved_at)).toBe(true);
      });

      it('allows a condition to open again after it was resolved, and limits the listing', async () => {
        const first = await s.alerts.openAlert(input('service_down:api'));
        await s.alerts.resolveAlert(first.id);
        const again = await s.alerts.openAlert(input('service_down:api'));

        expect(again.id).not.toBe(first.id);
        expect(await s.alerts.listAlerts()).toHaveLength(2);
        expect(await s.alerts.listAlerts({ limit: 1 })).toHaveLength(1);
        // Resolving twice keeps the first resolution.
        const before = (await s.alerts.listAlerts({ status: 'resolved' }))[0].resolved_at;
        await s.alerts.resolveAlert(first.id);
        expect((await s.alerts.listAlerts({ status: 'resolved' }))[0].resolved_at).toBe(before);
      });

      it('prunes alerts resolved long ago, never open ones', async () => {
        const row = (id: number, status: string, days: number) => ({
          id, ...input(`ci_failing:acme/r${id}`), status,
          opened_at: `${daysAgo(days + 1)}T00:00:00.000Z`,
          resolved_at: status === 'resolved' ? `${daysAgo(days)}T00:00:00.000Z` : null,
        });
        await s.admin.importAll({ alerts: [row(1, 'resolved', 100), row(2, 'resolved', 5), row(3, 'open', 200)] });

        await s.alerts.pruneResolved(90);

        expect(json(await s.alerts.listAlerts()).map((a: any) => a.id).sort()).toEqual([2, 3]);
      });
    });

    describe('alert channels', () => {
      const slack = {
        name: 'Team chat', type: 'slack', config: { url: 'https://hooks.example.com/T1/B2?a=1&b="x"' },
        kinds: ['ci_failing', 'service_down'], is_enabled: true, digest: 'daily' as const,
      };

      it('creates, lists oldest first, replaces and deletes channels', async () => {
        const created = await s.alertChannels.createChannel(slack);
        const other = await s.alertChannels.createChannel({
          name: 'Ops', type: 'telegram', config: { botToken: '123:abc', chatId: '-100' }, kinds: [], is_enabled: false, digest: 'off',
        });

        expect(json(created)).toMatchObject({
          id: expect.any(Number), ...slack, last_sent_at: null, last_error: null, last_digest_at: null,
        });
        expect(isIsoTimestamp(created.created_at)).toBe(true);
        expect(json(await s.alertChannels.listChannels()).map((c: any) => c.name)).toEqual(['Team chat', 'Ops']);
        expect(json(await s.alertChannels.getChannel(other.id))).toMatchObject({
          config: { botToken: '123:abc', chatId: '-100' }, kinds: [], is_enabled: false,
        });

        const updated = await s.alertChannels.updateChannel(created.id, { ...slack, name: 'Renamed', kinds: [], is_enabled: false, digest: 'weekly' });
        expect(json(updated)).toMatchObject({ id: created.id, name: 'Renamed', kinds: [], is_enabled: false, digest: 'weekly' });
        expect(await s.alertChannels.updateChannel(9999, slack)).toBeNull();
        expect(await s.alertChannels.getChannel(9999)).toBeNull();

        expect(await s.alertChannels.deleteChannel(created.id)).toBe(true);
        expect(await s.alertChannels.deleteChannel(created.id)).toBe(false);
        expect(await s.alertChannels.listChannels()).toHaveLength(1);
      });

      it('records the outcome of deliveries', async () => {
        const { id } = await s.alertChannels.createChannel(slack);

        await s.alertChannels.recordDelivery(id, { error: 'HTTP 404' });
        let channel = (await s.alertChannels.getChannel(id))!;
        expect(channel).toMatchObject({ last_error: 'HTTP 404', last_sent_at: null, last_digest_at: null });

        await s.alertChannels.recordDelivery(id, { error: null });
        channel = (await s.alertChannels.getChannel(id))!;
        expect(channel.last_error).toBeNull();
        expect(isIsoTimestamp(channel.last_sent_at)).toBe(true);
        expect(channel.last_digest_at).toBeNull();

        await s.alertChannels.recordDelivery(id, { error: null, digest: true });
        channel = (await s.alertChannels.getChannel(id))!;
        expect(isIsoTimestamp(channel.last_digest_at)).toBe(true);
      });
    });

    // ── Whole-storage export / import ─────────────────
    describe('admin', () => {
      it('exports everything and imports it back unchanged, ids included', async () => {
        await populateEverything(s);
        const dump = json(await s.admin.exportAll());

        expect(Object.keys(dump).sort()).toEqual([
          'activity_log', 'alert_channels', 'alerts', 'coverage_reports', 'groups', 'repo_apps', 'repo_groups',
          'repo_metrics_history', 'repo_signals', 'repo_traffic_daily', 'repo_traffic_sources', 'repos',
          'saved_views', 'service_checks', 'services',
        ]);
        expect(dump.repos.map((r: any) => r.full_name)).toEqual(['acme/plain', 'acme/tricky']);
        expect(dump.repo_metrics_history[0].snapshot_date).toBe(today());

        const copy = await harness.fresh();
        await copy.admin.importAll(dump);
        expect(json(await copy.admin.exportAll())).toEqual(dump);
        expect(json(await copy.repos.getRepo('acme/tricky'))).toMatchObject({
          description: 'has, commas "quotes"\nand a second line', topics: ['a,b'],
          blockers: ['one', 'two, three'], production_urls: { api: 'https://api.example.com' },
          priority: 'high', has_ci: false, groups: [],
        });
        expect(json(await copy.repos.getRepo('acme/plain')).groups).toEqual(['web']);

        // New records continue after the imported ids.
        const group = await copy.groups.createGroup('api', 'api');
        expect(group!.id).toBe(2);
        await copy.repos.refreshFromGitHub([ghRepo('plain'), ghRepo('tricky'), ghRepo('fresh')]);
        // (Not necessarily the very next one: SQL engines may skip ids on upserts.)
        expect((await copy.groups.getRepoId('acme/fresh'))!.id).toBeGreaterThan(2);
      });

      it('replaces whatever was there before', async () => {
        await populateEverything(s);
        const dump = json(await s.admin.exportAll());

        const other = await harness.fresh();
        await other.repos.refreshFromGitHub([ghRepo('leftover')]);
        await other.groups.createGroup('old', 'old');
        await other.admin.importAll(dump);

        expect(await other.repos.getRepo('acme/leftover')).toBeNull();
        expect(json(await other.groups.listGroups()).map((g: any) => g.slug)).toEqual(['web']);

        await other.admin.importAll({});
        expect(json(await other.admin.exportAll()).repos).toEqual([]);
      });
    });
  });
}

/** Puts data in every collection, with values that are awkward to store. */
export async function populateEverything(s: Storage) {
  await s.repos.refreshFromGitHub([
    ghRepo('plain'),
    ghRepo('tricky', { description: 'has, commas "quotes"\nand a second line', topics: ['a,b'], homepage: '' }),
  ]);
  await s.meta.patchRepoMeta('acme/tricky', {
    priority: 'high', notes: 'note', blockers: ['one', 'two, three'],
    production_urls: { api: 'https://api.example.com' }, has_ci: false,
  });
  await s.health.saveSummary('acme/plain', { title: 'T', keyFeatures: ['x', 'y'] });
  const group = await s.groups.createGroup('web', 'web apps', 'desc', '#ff0000');
  const plain = await s.groups.getRepoId('acme/plain');
  await s.groups.addRepoToGroup(plain!.id, group!.id);
  await s.services.createService({ name: 'svc', slug: 'svc', provider: 'gcp', url: 'https://svc.example.com' });
  await s.services.updateHealthCheck('svc', 'healthy', 12, 200);
  await s.apps.upsertApp({
    repo_full_name: 'acme/plain', app_path: 'apps/web', app_name: 'web',
    slug: 'acme-plain-web', stack: null, detection_source: 'manual',
  });
  await s.coverage.upsertCoverage('acme/plain', 'web', 91, 'abc');
  await s.metrics.upsertSnapshot(snapshotInput(plain!.id, 'acme/plain'));
  await s.traffic.upsertDaily('acme/plain', [{ day: today(), views: 12, views_unique: 5, clones: 3, clones_unique: 2 }]);
  await s.savedViews.upsertSavedView('Stale, "quoted"', 'stale=1&q=a%2Cb');
  const alert = await s.alerts.openAlert({
    key: 'ci_failing:acme/tricky', kind: 'ci_failing', entity: 'acme/tricky', title: 'CI is failing, "again"',
    detail: { workflow: 'CI', attempts: [1, 2] }, url: 'https://example.com/run?a=1,2', level: 0,
  });
  await s.alerts.resolveAlert(alert.id);
  await s.alertChannels.createChannel({
    name: 'Chat, "main"', type: 'slack', config: { url: 'https://hooks.example.com/a,b' },
    kinds: ['ci_failing'], is_enabled: true, digest: 'weekly',
  });
  await s.signals.upsertSignal('acme/tricky', 'standards', {
    passed: 1, total: 2, checks: [{ key: 'license', label: 'License, "MIT"', passed: null }],
  });
  await s.serviceChecks.recordCheck('svc', 'healthy', 12, 200);
  await s.serviceChecks.recordCheck('svc', 'down', null, null);
  await s.traffic.replaceSources('acme/plain', today(), 'referrer', [{ label: 'google.com', hits: 9, uniques: 4 }]);
  await s.activity.logActivity({
    action: 'x', entityType: 'repo', entityId: 'acme/plain', actorType: 'human', actorName: 'user',
    newValue: '-5', metadata: { nested: { list: [1, 2] } },
  });
}
