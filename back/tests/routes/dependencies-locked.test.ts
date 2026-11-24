import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryEnv, mockEnv, repoRecord } from '../helpers';

vi.mock('@back/lib/github', () => ({
  getReposWithMetrics: vi.fn(), getRepoDetails: vi.fn(), getRepoReadme: vi.fn(), archiveRepo: vi.fn(), checkRepoHealth: vi.fn(),
}));

import app from '@back/index';
import type { Storage } from '@back/application/ports/storage';

let env: any;
let storage: Storage;
const get = async (path: string) => {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${mockEnv.API_KEY}` } }, env);
  return { status: res.status, body: await res.json() as any };
};
const dep = (ecosystem: string, name: string, version: string) => ({ ecosystem, name, version, major: version.replace(/\D*(\d+).*/, '$1'), scope: 'prod', manifest: 'package.json' });

describe('dependencies with lockfiles', () => {
  beforeEach(async () => {
    ({ env, storage } = memoryEnv());
    await storage.repos.refreshFromGitHub([repoRecord('acme/api'), repoRecord('acme/web'), repoRecord('acme/old', { is_archived: true })]);
    await storage.signals.upsertSignal('acme/api', 'dependencies', { items: [dep('npm', 'react', '^18.2.0'), dep('pypi', 'PyYAML', '>=6')], runtimes: [] });
    await storage.signals.upsertSignal('acme/api', 'lockfile', { total: 4, items: [
      ['npm', 'react', '18.3.1'], ['npm', 'lodash', '4.17.20'], ['npm', 'lodash', '4.17.21'], ['pypi', 'pyyaml', '6.0.2'],
    ] });
    await storage.signals.upsertSignal('acme/web', 'dependencies', { items: [dep('npm', 'react', '^19.0.0'), dep('npm', 'lodash', '^4.17.0')], runtimes: [] });
    await storage.signals.upsertSignal('acme/web', 'lockfile', { total: 2, items: [['npm', 'react', '19.1.0'], ['npm', 'lodash', '4.17.21']] });
    await storage.signals.upsertSignal('acme/old', 'lockfile', { total: 1, items: [['npm', 'lodash', '3.10.1']] });
  });

  it('adds the resolved version of each declared dependency to the inventory', async () => {
    const { body } = await get('/api/dependencies');
    expect(body.locked).toEqual({ repos: 2, packages: 6 });

    const usage = (name: string, repo: string) => body.packages.find((pkg: any) => pkg.name === name).usages.find((u: any) => u.repo === repo);
    expect(usage('react', 'acme/api')).toMatchObject({ version: '^18.2.0', resolved: ['18.3.1'] });
    expect(usage('react', 'acme/web')).toMatchObject({ version: '^19.0.0', resolved: ['19.1.0'] });
    // Python names match whatever their case or separators.
    expect(usage('PyYAML', 'acme/api').resolved).toEqual(['6.0.2']);
  });

  it('leaves the resolved version empty for a repo without a lockfile', async () => {
    await storage.signals.upsertSignal('acme/web', 'lockfile', { total: 0, items: [] });
    const { body } = await get('/api/dependencies');
    expect(body.packages.find((pkg: any) => pkg.name === 'lodash').usages[0].resolved).toEqual([]);
    expect(body.locked).toEqual({ repos: 1, packages: 4 });
  });

  describe('locating a package', () => {
    it('finds it in every active repo, saying whether it is declared or only transitive', async () => {
      const { body } = await get('/api/dependencies/locate?name=lodash');
      expect(body).toEqual({
        query: 'lodash', exact: true, repos: 2,
        locations: [
          { repo: 'acme/api', ecosystem: 'npm', name: 'lodash', versions: ['4.17.20', '4.17.21'], direct: false },
          { repo: 'acme/web', ecosystem: 'npm', name: 'lodash', versions: ['4.17.21'], direct: true },
        ],
      });
    });

    it('ignores case, and falls back to names that contain the text', async () => {
      expect((await get('/api/dependencies/locate?name=LODASH')).body.exact).toBe(true);

      const { body } = await get('/api/dependencies/locate?name=yam');
      expect(body).toMatchObject({ exact: false, repos: 1 });
      expect(body.locations).toEqual([{ repo: 'acme/api', ecosystem: 'pypi', name: 'pyyaml', versions: ['6.0.2'], direct: true }]);
    });

    it('answers empty when it is nowhere, and asks for a name', async () => {
      expect((await get('/api/dependencies/locate?name=left-pad')).body).toMatchObject({ exact: false, repos: 0, locations: [] });
      expect((await get('/api/dependencies/locate')).status).toBe(400);
      expect((await get('/api/dependencies/locate?name=a')).status).toBe(400);
    });

    it('requires authentication', async () => {
      expect((await app.request('/api/dependencies/locate?name=lodash', {}, env)).status).toBe(401);
    });
  });

  describe('known vulnerabilities', () => {
    const found = (id: string, name: string, version: string, severity: string) => ({
      id, aliases: [], ecosystem: 'npm', name, version, severity, summary: `${name} problem`, fixed: null, url: `https://osv.dev/vulnerability/${id}`,
    });

    it('lists them across active repos, worst and most widespread first', async () => {
      await storage.signals.upsertSignal('acme/api', 'vulnerabilities', { enabled: true, checked: 40, total: 2, truncated: true,
        items: [found('GHSA-1', 'lodash', '4.17.15', 'high'), found('GHSA-2', 'minimist', '1.2.0', 'critical')] });
      await storage.signals.upsertSignal('acme/web', 'vulnerabilities', { enabled: true, checked: 10, total: 2,
        items: [found('GHSA-1', 'lodash', '4.17.15', 'high'), found('GHSA-3', 'ws', '7.0.0', 'high')] });
      await storage.signals.upsertSignal('acme/old', 'vulnerabilities', { enabled: true, checked: 5, total: 1, items: [found('GHSA-9', 'old', '1.0.0', 'critical')] });

      const { status, body } = await get('/api/dependencies/vulnerabilities');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        enabled: false, repos_checked: 2, repos_affected: 2, packages_checked: 50, total: 3, truncated: ['acme/api'],
        bySeverity: { critical: 1, high: 2, moderate: 0, low: 0, unknown: 0 },
      });
      expect(body.items.map((item: any) => [item.id, item.repos])).toEqual([
        ['GHSA-2', ['acme/api']], ['GHSA-1', ['acme/api', 'acme/web']], ['GHSA-3', ['acme/web']],
      ]);
    });

    it('is empty, and says whether the lookup is on, when nothing was checked', async () => {
      await storage.signals.upsertSignal('acme/api', 'vulnerabilities', { enabled: false });
      env.POLICY = 'signals: { known_vulnerabilities: true }';
      expect((await get('/api/dependencies/vulnerabilities')).body).toMatchObject({ enabled: true, repos_checked: 0, total: 0, items: [] });
    });
  });
});
