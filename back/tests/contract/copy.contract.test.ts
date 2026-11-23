/**
 * Moving data between storages: a full export from one adapter imported into
 * the next, through every adapter in turn, must end up identical.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { Storage } from '@back/application/ports/storage';
import { createFileStorage } from '@back/infrastructure/storage/file';
import { createMemoryStorage } from '@back/infrastructure/storage/memory';
import { createSqlStorage } from '@back/infrastructure/storage/sql';
import { migrate } from '@back/infrastructure/storage/sql/migrate';
import { createSqliteClient } from '@back/infrastructure/storage/sql/sqlite-client';
import { createPgliteClient } from './pglite-client';
import { json, populateEverything } from './storage-contract';

const dir = mkdtempSync(join(tmpdir(), 'ghc-copy-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('copying data across storage adapters', () => {
  it('survives memory -> sqlite -> csv -> postgres -> json unchanged', async () => {
    const sqlite = createSqliteClient(join(dir, 'app.db'));
    await migrate(sqlite);
    const postgres = createPgliteClient(new PGlite());
    await migrate(postgres);

    const chain: [string, Storage][] = [
      ['sqlite', createSqlStorage(sqlite)],
      ['csv', createFileStorage({ dir: join(dir, 'csv'), format: 'csv' })],
      ['postgres', createSqlStorage(postgres)],
      ['json', createFileStorage({ dir: join(dir, 'json'), format: 'json' })],
    ];

    const source = createMemoryStorage();
    await populateEverything(source);
    const original = json(await source.admin.exportAll());

    let dump = original;
    for (const [name, storage] of chain) {
      await storage.admin.importAll(dump);
      dump = json(await storage.admin.exportAll());
      expect(dump, `after ${name}`).toEqual(original);
    }

    // The copy is a working storage, not just matching bytes.
    const last = chain.at(-1)![1];
    expect(json(await last.repos.listRepos()).map((r: any) => [r.full_name, r.groups])).toEqual(
      json(await source.repos.listRepos()).map((r: any) => [r.full_name, r.groups]),
    );
    expect(json(await last.groups.listGroups())).toEqual(json(await source.groups.listGroups()));
  });
});
