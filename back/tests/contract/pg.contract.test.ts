/**
 * Runs the contract through the real node-postgres driver, talking the
 * Postgres wire protocol to an embedded server (PGlite behind a socket), on a
 * schema created by the app's own migrations.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createSqlStorage } from '@back/infrastructure/storage/sql';
import { migrate, MIGRATIONS } from '@back/infrastructure/storage/sql/migrate';
import { createPgClient } from '@back/infrastructure/storage/sql/pg-client';
import { COLLECTIONS } from '@back/infrastructure/storage/schema';
import { describeStorageContract } from './storage-contract';

const PORT = 54000 + Math.floor(Math.random() * 1000);
const TABLES = Object.keys(COLLECTIONS).join(', ');
const url = (port: number) => `postgres://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

let pglite: PGlite;
let server: PGLiteSocketServer;
let db: ReturnType<typeof createPgClient>;

beforeAll(async () => {
  pglite = new PGlite();
  server = new PGLiteSocketServer({ db: pglite, port: PORT, host: '127.0.0.1' });
  await server.start();
  db = createPgClient(url(PORT));
  await migrate(db);
});

afterAll(async () => {
  await db.close();
  await server.stop();
  await pglite.close();
});

describeStorageContract('postgres (node-postgres)', {
  async fresh(snapshots = []) {
    const client = resilient(db);
    await client.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    for (const row of snapshots) {
      const columns = Object.keys(row);
      await client.query(
        `INSERT INTO repo_metrics_history (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        Object.values(row),
      );
    }
    return createSqlStorage(client);
  },
});

/**
 * The embedded test server drops the connection after a statement fails (a
 * real Postgres does not). The pool reconnects, but the next statement may
 * still be handed the dead connection, so the harness retries that one case.
 */
function resilient(client: typeof db): typeof db {
  const retry = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error: any) {
      if (!/Connection terminated|Client has encountered a connection error/.test(error.message)) throw error;
      return run();
    }
  };
  return {
    ...client,
    query: (sql, params) => retry(() => client.query(sql, params)),
    queryOne: (sql, params) => retry(() => client.queryOne(sql, params)),
    batch: (statements) => retry(() => client.batch(statements)),
  };
}

describe('migrations', () => {
  it('are recorded and not applied twice', async () => {
    expect(await migrate(resilient(db))).toEqual([]);
    const rows = await db.query('SELECT version, name FROM schema_migrations ORDER BY version');
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
  });

  it('adopt a database created before migrations existed, without touching it', async () => {
    const legacy = new PGlite();
    await legacy.exec(readFileSync(join(__dirname, '../fixtures/legacy-schema.sql'), 'utf8'));
    await legacy.exec('SET search_path TO public');
    const legacyServer = new PGLiteSocketServer({ db: legacy, port: PORT + 1, host: '127.0.0.1' });
    await legacyServer.start();
    const client = createPgClient(url(PORT + 1));
    try {
      // The baseline is adopted as-is; only the later migrations run.
      expect(await migrate(client)).toEqual([2, 3, 4]);
      expect(await client.query('SELECT version FROM schema_migrations ORDER BY version')).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
      await client.query(`INSERT INTO repos (full_name, owner, name, ci_status) VALUES ('a/b', 'a', 'b', 'success')`);
    } finally {
      await client.close();
      await legacyServer.stop();
      await legacy.close();
    }
  });

  it('roll back a batch that fails midway', async () => {
    await resilient(db).query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    await expect(db.batch([
      { sql: `INSERT INTO groups (slug, name) VALUES ('a', 'a')` },
      { sql: `INSERT INTO groups (slug, name) VALUES ('a', 'duplicate')` },
    ])).rejects.toThrow();
    expect(await resilient(db).query('SELECT * FROM groups')).toEqual([]);
  });
});
