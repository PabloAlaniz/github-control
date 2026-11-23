import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createSqlStorage } from '@back/infrastructure/storage/sql';
import { migrate } from '@back/infrastructure/storage/sql/migrate';
import { createSqliteClient } from '@back/infrastructure/storage/sql/sqlite-client';
import { describeStorageContract, ghRepo } from './storage-contract';

const dir = mkdtempSync(join(tmpdir(), 'ghc-sqlite-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function seed(db: ReturnType<typeof createSqliteClient>, snapshots: Record<string, unknown>[]) {
  for (const row of snapshots) {
    const columns = Object.keys(row);
    await db.query(
      `INSERT INTO repo_metrics_history (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(row),
    );
  }
}

describeStorageContract('sqlite', {
  async fresh(snapshots = []) {
    const db = createSqliteClient(':memory:');
    await migrate(db);
    await seed(db, snapshots);
    return createSqlStorage(db);
  },
});

describe('sqlite adapter specifics', () => {
  it('keeps data in a single file across restarts', async () => {
    const path = join(dir, 'nested', 'app.db');
    const first = createSqliteClient(path);
    expect(await migrate(first)).toEqual([1, 2, 3, 4, 5]);
    const storage = createSqlStorage(first);
    await storage.repos.refreshFromGitHub([ghRepo('a', { topics: ['x'] })]);
    await storage.meta.patchRepoMeta('acme/a', { blockers: ['b1'], production_urls: { api: 'https://a.example.com' } });
    first.close();

    const second = createSqliteClient(path);
    expect(await migrate(second)).toEqual([]); // already up to date
    const repo = await createSqlStorage(second).repos.getRepo('acme/a');
    expect(repo).toMatchObject({
      full_name: 'acme/a', topics: ['x'], blockers: ['b1'], is_deleted: false,
      production_urls: { api: 'https://a.example.com' }, groups: [],
    });
    second.close();
  });

  it('rolls back a failed batch entirely', async () => {
    const db = createSqliteClient(':memory:');
    await migrate(db);
    await expect(db.batch([
      { sql: `INSERT INTO groups (slug, name) VALUES ('a', 'a')` },
      { sql: `INSERT INTO groups (slug, name) VALUES ('a', 'duplicate')` },
    ])).rejects.toThrow();
    expect(await db.query('SELECT * FROM groups')).toEqual([]);
  });

  it('upserts more repos than fit in one statement', async () => {
    const db = createSqliteClient(':memory:');
    await migrate(db);
    const storage = createSqlStorage(db);
    const many = Array.from({ length: 450 }, (_, i) => ghRepo(`repo-${String(i).padStart(3, '0')}`));
    await storage.repos.refreshFromGitHub(many);
    expect((await storage.repos.getStats()).total).toBe(450);
    const result = await storage.repos.refreshFromGitHub(many.slice(0, 449));
    expect(result.removedRepos).toEqual(['acme/repo-449']);
  });
});
