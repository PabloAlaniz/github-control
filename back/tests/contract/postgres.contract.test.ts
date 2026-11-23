/**
 * Runs the storage contract the way a Cloudflare Workers deployment runs:
 * through the Neon client, against a database that predates migrations (the
 * legacy schema fixture) brought up to date with `migrate`. Only the network
 * driver is replaced; every statement the adapter issues is executed by an
 * embedded Postgres (PGlite).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStorage } from '@back/infrastructure/storage/memory';
import { createPostgresStorage } from '@back/infrastructure/storage/sql';
import { COLLECTIONS } from '@back/infrastructure/storage/schema';
import { migrate } from '@back/infrastructure/storage/sql/migrate';
import { createPgliteClient } from './pglite-client';
import { describeStorageContract, ghRepo, json } from './storage-contract';

const pg = vi.hoisted(() => ({ db: null as any }));

// Only the network driver is replaced: PGlite stands in for Neon.
vi.mock('@back/infrastructure/storage/sql/neon', () => {
  const query = async (_config: unknown, sql: string, params: unknown[] = []) =>
    (await pg.db.query(sql, params)).rows;
  return {
    query,
    queryOne: async (config: unknown, sql: string, params: unknown[] = []) =>
      (await query(config, sql, params))[0] || null,
    // Mirrors the Neon client: statements are built first, then run in one transaction.
    getDb: () => Object.assign(
      (sql: string, params: unknown[] = []) => ({ sql, params }),
      {
        transaction: (statements: { sql: string; params: unknown[] }[]) =>
          pg.db.transaction(async (tx: any) => {
            const results = [];
            for (const { sql, params } of statements) results.push((await tx.query(sql, params)).rows);
            return results;
          }),
      },
    ),
  };
});

const config: any = { DATABASE_URL: 'pglite://memory' };
const TABLES = Object.keys(COLLECTIONS).join(', ');

beforeAll(async () => {
  pg.db = new PGlite();
  await pg.db.exec(readFileSync(join(__dirname, '../fixtures/legacy-schema.sql'), 'utf8'));
  await pg.db.exec('SET search_path TO public');
  await migrate(createPgliteClient(pg.db));
});

afterAll(async () => {
  await pg.db.close();
});

const harness = {
  async fresh(snapshots: Record<string, unknown>[] = []) {
    await pg.db.exec(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    for (const row of snapshots) {
      const columns = Object.keys(row);
      await pg.db.query(
        `INSERT INTO repo_metrics_history (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row),
      );
    }
    return createPostgresStorage(config);
  },
};

describeStorageContract('postgres', harness);

describe('adapter parity: memory vs postgres', () => {
  const keys = (row: unknown) => Object.keys(json(row)).sort();

  it('produces records with exactly the same fields', async () => {
    const postgres = await harness.fresh();
    const memory = createMemoryStorage();

    for (const s of [postgres, memory]) {
      await s.repos.refreshFromGitHub([ghRepo('a', { homepage: 'https://a.example.com' })]);
      const group = await s.groups.createGroup('web', 'web');
      await s.groups.addRepoToGroup((await s.groups.getRepoId('acme/a'))!.id, group!.id);
      await s.services.createService({ name: 'svc', slug: 'svc', provider: 'gcp', source_repo_full_name: 'acme/a' });
      await s.apps.upsertApp({
        repo_full_name: 'acme/a', app_path: 'apps/web', app_name: 'web',
        slug: 'acme-a-web', stack: 'node', detection_source: 'manual',
      });
      await s.activity.logActivity({ action: 'x', entityType: 'repo', entityId: 'acme/a', actorType: 'human', actorName: 'user' });
    }

    const sample = async (s: typeof memory) => ({
      repo: keys(await s.repos.getRepo('acme/a')),
      listedRepo: keys((await s.repos.listRepos())[0]),
      filteredRepo: keys((await s.repos.filterRepos({}))[0]),
      group: keys((await s.groups.listGroups())[0]),
      service: keys(await s.services.getService('svc')),
      listedService: keys((await s.services.listServices({}))[0]),
      serviceByRepo: keys((await s.services.listServicesByRepo('acme/a'))[0]),
      app: keys(await s.apps.getApp('acme-a-web')),
      enrichedApp: keys((await s.repos.listAllAppsEnriched())[0]),
      activity: keys((await s.activity.listActivities({ limit: 1, offset: 0 }))[0]),
    });

    expect(await sample(memory)).toEqual(await sample(postgres));
  });
});
