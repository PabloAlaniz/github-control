import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createFileStorage, type FileFormat } from '@back/infrastructure/storage/file';
import { CODECS, parseCsv } from '@back/infrastructure/storage/file/codecs';
import { MemoryDb } from '@back/infrastructure/storage/memory/db';
import { emptyState } from '@back/infrastructure/storage/memory';
import { COLLECTIONS, columnType, columnsOf, type CollectionName } from '@back/infrastructure/storage/schema';
import { describeStorageContract, ghRepo } from './storage-contract';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ghc-store-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

for (const format of ['json', 'csv'] as FileFormat[]) {
  describeStorageContract(`file (${format})`, {
    // Seed records are written as files first, so the suite also covers loading existing data.
    async fresh(snapshots = []) {
      const dir = tempDir();
      if (snapshots.length > 0) {
        const state = emptyState();
        const db = new MemoryDb(state);
        snapshots.forEach((row) => db.insert('repo_metrics_history', row));
        const codec = CODECS[format];
        writeFileSync(
          join(dir, `repo_metrics_history.${codec.extension}`),
          codec.encode('repo_metrics_history', state.repo_metrics_history),
        );
        writeFileSync(join(dir, '_meta.json'), JSON.stringify({ format, version: 1, seq: state.seq }));
      }
      return createFileStorage({ dir, format });
    },
  });

  describe(`file store persistence (${format})`, () => {
    /** Exercises every collection and every kind of value, including awkward text. */
    async function populate(dir: string) {
      const s = createFileStorage({ dir, format });
      await s.repos.refreshFromGitHub([
        ghRepo('plain'),
        ghRepo('tricky', {
          description: 'has, commas "quotes"\nand a second line',
          topics: ['a,b', 'c"d'], homepage: '', language: null, stars: 0,
        }),
        ghRepo('formula', { description: '=HYPERLINK("http://evil")' }),
        ghRepo('apostrophe', { description: "'quoted start" }),
      ]);
      await s.meta.patchRepoMeta('acme/tricky', {
        priority: 'high', notes: '  padded  ', blockers: ['one', 'two, three'],
        production_urls: { api: 'https://api.example.com' }, has_ci: false, test_coverage: 0,
      });
      await s.health.saveSummary('acme/plain', { title: 'T', keyFeatures: ['x', 'y'] });
      const group = await s.groups.createGroup('web', 'web apps', 'desc', '#ff0000');
      await s.groups.addRepoToGroup((await s.groups.getRepoId('acme/plain'))!.id, group!.id);
      await s.services.createService({ name: 'svc', slug: 'svc', provider: 'gcp', url: 'https://svc.example.com' });
      await s.services.updateHealthCheck('svc', 'healthy', 0, 200);
      await s.apps.upsertApp({
        repo_full_name: 'acme/plain', app_path: 'apps/web', app_name: 'web',
        slug: 'acme-plain-web', stack: null, detection_source: 'manual',
      });
      await s.coverage.upsertCoverage('acme/plain', 'web', 91, 'abc');
      await s.metrics.upsertSnapshot({
        repoId: 1, fullName: 'acme/plain',
        code: { sizeKb: null, fileCount: 3, loc: 30 },
        github: { stars: 1, forks: 0, watchers: 0, subscribersCount: 0, openIssues: 0 },
        health: { hasCi: true, hasTests: false, hasReadme: true, readmeLines: 5, hasGitignore: true, hasRoadmap: false, docsFileCount: 0, docsQuality: 'good' },
        meta: { language: null, isPrivate: false, isArchived: false, isFork: false, isTemplate: false, defaultBranch: 'main' },
      });
      await s.activity.logActivity({
        action: 'x', entityType: 'repo', entityId: 'acme/plain', actorType: 'human', actorName: 'user',
        newValue: '-5', metadata: { nested: { list: [1, 2] } },
      });
      const today = new Date().toISOString().slice(0, 10);
      await s.traffic.upsertDaily('acme/plain', [{ day: today, views: 3, views_unique: 2, clones: 1, clones_unique: 1 }]);
      await s.traffic.replaceSources('acme/plain', today, 'path', [{ label: '/acme/plain', title: 'a, "title"', hits: 3, uniques: 2 }]);
      await s.savedViews.upsertSavedView('Stale, "quoted"', 'stale=1&q=a%2Cb');
      await s.signals.upsertSignal('acme/tricky', 'standards', { passed: 0, total: 2, checks: [{ label: 'a, "b"\nc', passed: null }] });
      await s.serviceChecks.recordCheck('svc', 'down', null, null);
      await s.serviceChecks.recordCheck('svc', 'healthy', 0, 200);
      return s;
    }

    /** Everything observable through the ports. */
    async function dump(s: Awaited<ReturnType<typeof populate>>) {
      return {
        repos: await s.repos.listRepos({ includeArchived: true, includeDeleted: true, includePaused: true }),
        groups: await s.groups.listGroups(),
        edges: await s.groups.listAllRepoGroupEdges(),
        services: await s.services.listServices({}),
        apps: await s.apps.listApps(),
        coverage: await s.coverage.listCoverageReports('acme/plain'),
        metrics: await s.metrics.getSnapshot(new Date().toISOString().slice(0, 10)),
        activity: await s.activity.listActivities({ limit: 10, offset: 0 }),
        traffic: await s.traffic.getDaily('acme/plain', 7),
        paths: await s.traffic.getSources('acme/plain', 'path'),
      };
    }

    it('reads back exactly what it wrote', async () => {
      const dir = tempDir();
      const written = await dump(await populate(dir));
      const reopened = await dump(createFileStorage({ dir, format }));

      expect(reopened).toEqual(written);
      expect(reopened.repos.find((r) => r.name === 'tricky')).toMatchObject({
        description: 'has, commas "quotes"\nand a second line', topics: ['a,b', 'c"d'],
        homepage: '', language: null, stars: 0, notes: '  padded  ',
        blockers: ['one', 'two, three'], has_ci: false, test_coverage: 0, has_tests: null,
      });
    });

    it('keeps handing out new ids after a restart', async () => {
      const dir = tempDir();
      await populate(dir);
      const reopened = createFileStorage({ dir, format });
      const group = await reopened.groups.createGroup('api', 'api');
      expect(group!.id).toBe(2);
      await reopened.repos.refreshFromGitHub([ghRepo('plain'), ghRepo('fresh')]);
      expect((await reopened.groups.getRepoId('acme/fresh'))!.id).toBe(5);
    });

    it('writes one file per collection plus the metadata file', async () => {
      const dir = tempDir();
      await populate(dir);
      const ext = CODECS[format].extension;
      expect(readdirSync(dir).sort()).toEqual(
        ['_meta.json', ...Object.keys(COLLECTIONS).map((c) => `${c}.${ext}`)].sort(),
      );
    });

    it('refuses a directory written in another format', async () => {
      const dir = tempDir();
      await populate(dir);
      const other: FileFormat = format === 'json' ? 'csv' : 'json';
      expect(() => createFileStorage({ dir, format: other })).toThrow(/holds .* data/);
    });

    it('survives concurrent writes without losing any', async () => {
      const dir = tempDir();
      const s = createFileStorage({ dir, format });
      await Promise.all(Array.from({ length: 25 }, (_, i) => s.groups.createGroup(`g${i}`, `group ${i}`)));
      expect(await createFileStorage({ dir, format }).groups.listGroups()).toHaveLength(25);
    });
  });
}

describe('csv format', () => {
  it('neutralizes spreadsheet formulas without changing the stored value', async () => {
    const dir = tempDir();
    const s = createFileStorage({ dir, format: 'csv' });
    await s.repos.refreshFromGitHub([ghRepo('f', { description: '=1+1' })]);
    const csv = readFileSync(join(dir, 'repos.csv'), 'utf8');
    expect(csv).toContain(",'=1+1,");
    expect((await createFileStorage({ dir, format: 'csv' }).repos.getRepo('acme/f'))!.description).toBe('=1+1');
  });

  it('distinguishes an empty string from a missing value', () => {
    const [header, row] = parseCsv('a,b,c\n,"",x\n');
    expect(header.map((c) => c.text)).toEqual(['a', 'b', 'c']);
    expect(row).toEqual([{ text: '', quoted: false }, { text: '', quoted: true }, { text: 'x', quoted: false }]);
  });

  it('rejects files with unknown columns or ragged rows', () => {
    expect(() => CODECS.csv.decode('groups', 'id,slug,bogus\n1,a,b\n')).toThrow(/unknown columns: bogus/);
    expect(() => CODECS.csv.decode('groups', 'id,slug\n1\n')).toThrow(/row 2: expected 2 cells, found 1/);
  });
});

describe('logical schema', () => {
  it('matches the Postgres baseline column for column, type for type', async () => {
    const pg = new PGlite();
    await pg.exec(readFileSync(join(__dirname, '../fixtures/legacy-schema.sql'), 'utf8'));
    const { rows } = await pg.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position
    `);
    await pg.close();

    const expectedType = (dataType: string) => {
      if (dataType === 'integer') return 'int';
      if (dataType === 'boolean') return 'bool';
      if (dataType === 'date') return 'date';
      if (dataType.startsWith('timestamp')) return 'timestamp';
      if (dataType === 'jsonb' || dataType === 'ARRAY') return 'json';
      return 'text';
    };

    for (const collection of Object.keys(COLLECTIONS) as CollectionName[]) {
      const columns = rows.filter((r) => r.table_name === collection);
      if (columns.length === 0) continue; // collection added after the legacy schema
      expect(columnsOf(collection).sort(), collection).toEqual(columns.map((c) => c.column_name).sort());
      for (const column of columns) {
        expect(columnType(collection, column.column_name), `${collection}.${column.column_name}`)
          .toBe(expectedType(column.data_type));
      }
    }
  });
});
