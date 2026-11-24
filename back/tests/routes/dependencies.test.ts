import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn().mockResolvedValue(null),
  archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

const mockRepoGet = vi.fn();
const mockGetTree = vi.fn();
const mockGetContent = vi.fn();
vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    repos: { get: mockRepoGet, getContent: mockGetContent },
    git: { getTree: mockGetTree },
  }),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';
import { buildDependencyInventory } from '@back/services/dependency.service';

let env: any;
let storage: Storage;
const request = (path: string, init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const item = (name: string, version: string, major: string | null, scope = 'prod') =>
  ({ ecosystem: 'npm', name, version, major, scope, manifest: 'package.json' });

describe('dependencies', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([
      repoRecord('acme/a'), repoRecord('acme/b'), repoRecord('acme/old', { is_archived: true }),
    ]);
  });

  describe('GET /api/dependencies', () => {
    it('aggregates packages across active repos and flags divergent majors and EOL runtimes', async () => {
      await storage.signals.upsertSignal('acme/a', 'dependencies', {
        items: [item('react', '^17.0.2', '17'), item('vite', 'latest', null, 'dev')],
        runtimes: [
          { name: 'node', version: '18', source: '.nvmrc', release: '18', eolDate: '2025-04-30' },
          { name: 'go', version: '1.22', source: 'go.mod', release: '1', eolDate: null },
        ],
      });
      await storage.signals.upsertSignal('acme/b', 'dependencies', {
        items: [item('react', '^18.2.0', '18')],
        runtimes: [{ name: 'node', version: '99', source: '.nvmrc', release: '99', eolDate: '2999-01-01' }],
      });
      // Archived repos are not part of the inventory.
      await storage.signals.upsertSignal('acme/old', 'dependencies', { items: [item('react', '^16.0.0', '16')], runtimes: [] });

      const body = await (await request('/api/dependencies')).json();

      expect(body.repos_synced).toBe(2);
      expect(body.packages).toEqual([
        {
          ecosystem: 'npm', name: 'react', repo_count: 2, majors: ['17', '18'], divergent: true,
          usages: [
            { repo: 'acme/a', version: '^17.0.2', major: '17', scope: 'prod', manifest: 'package.json', resolved: [] },
            { repo: 'acme/b', version: '^18.2.0', major: '18', scope: 'prod', manifest: 'package.json', resolved: [] },
          ],
        },
        expect.objectContaining({ name: 'vite', repo_count: 1, majors: [], divergent: false }),
      ]);
      expect(body.runtimes.map((r: any) => [r.repo, r.name, r.eol])).toEqual([
        ['acme/a', 'node', true], ['acme/a', 'go', null], ['acme/b', 'node', false],
      ]);
    });

    it('returns empty lists when nothing was synced', async () => {
      expect(await (await request('/api/dependencies')).json()).toEqual({ repos_synced: 0, locked: { repos: 0, packages: 0 }, packages: [], runtimes: [] });
    });

    it('counts a package once per repo and tolerates signals without lists', async () => {
      await storage.signals.upsertSignal('acme/a', 'dependencies', {
        items: [item('zod', '^3.0.0', '3'), { ...item('zod', '^3.1.0', '3'), manifest: 'web/package.json' }],
      });
      await storage.signals.upsertSignal('acme/b', 'dependencies', {});

      const inventory = await buildDependencyInventory({ config: env, storage });

      expect(inventory.repos_synced).toBe(2);
      expect(inventory.packages[0]).toMatchObject({ name: 'zod', repo_count: 1, divergent: false });
      expect(inventory.packages[0].usages).toHaveLength(2);
    });
  });

  describe('dependencies signal sync', () => {
    it('reads manifests from the repo and stores a summary plus the item list', async () => {
      mockRepoGet.mockResolvedValue({ data: { default_branch: 'main' } });
      mockGetTree.mockResolvedValue({ data: { tree: [{ path: 'package.json' }, { path: '.nvmrc' }, { path: 'gone/go.mod' }, { path: 'src/a.ts' }] } });
      mockGetContent.mockImplementation(async ({ path }: { path: string }) => {
        if (path === 'package.json') return { data: { content: b64(JSON.stringify({ dependencies: { hono: '^4.0.0' }, devDependencies: { vitest: '^1.6.0' } })) } };
        if (path === '.nvmrc') return { data: { content: b64('18\n') } };
        throw { status: 404 };
      });

      const res = await request('/api/repos/acme/a/signals/sync?kinds=dependencies', { method: 'POST' });

      expect((await res.json()).ok).toBe(true);
      const [stored] = await storage.signals.getRepoSignals('acme/a');
      expect(stored.data).toMatchObject({
        manifests: ['.nvmrc', 'package.json', 'gone/go.mod'],
        total: 2,
        ecosystems: { npm: 2 },
        runtimes: [{ name: 'node', version: '18', release: '18', eolDate: '2025-04-30' }],
      });
      expect(stored.data.items.map((i: any) => i.name)).toEqual(['hono', 'vitest']);
    });

    it('stores an empty inventory for a repo without manifests', async () => {
      mockRepoGet.mockResolvedValue({ data: { default_branch: 'main' } });
      mockGetTree.mockResolvedValue({ data: { tree: [{ path: 'README.md' }] } });

      await request('/api/repos/acme/a/signals/sync?kinds=dependencies', { method: 'POST' });

      expect((await storage.signals.getRepoSignals('acme/a'))[0].data).toEqual({
        manifests: [], total: 0, ecosystems: {}, runtimes: [], items: [],
      });
      expect(mockGetContent).not.toHaveBeenCalled();
    });
  });
});
