/**
 * Schema migrations for the SQL adapter. Runs at startup on Node; applies,
 * in order and each in its own transaction, the migrations a database has
 * not seen yet.
 *
 * To change the schema: update `../schema.ts`, then append a migration here
 * with the statements for each engine. Never edit a released migration.
 * Migrations must be idempotent: the baseline creates the current schema, so
 * on a new database every later migration finds its change already there.
 */
import type { Dialect, SqlClient } from './client';
import { baselineStatements, createIndexes, createTable } from './ddl';

interface Migration {
  version: number;
  name: string;
  statements: (dialect: Dialect) => string[];
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline', statements: baselineStatements },
  {
    // Databases older than the baseline restricted ci_status to three values,
    // but it stores GitHub's run conclusion (success, failure, cancelled, ...).
    version: 2,
    name: 'ci_status_any_conclusion',
    statements: (dialect) => (dialect.name === 'postgres'
      ? ['ALTER TABLE repos DROP CONSTRAINT IF EXISTS repos_ci_status_check']
      : []),
  },
  {
    version: 3,
    name: 'traffic_history',
    statements: (dialect) => [
      createTable('repo_traffic_daily', dialect),
      createTable('repo_traffic_sources', dialect),
    ],
  },
  {
    version: 4,
    name: 'saved_views_signals_service_checks',
    statements: (dialect) => [
      createTable('saved_views', dialect),
      createTable('repo_signals', dialect),
      createTable('service_checks', dialect),
      ...createIndexes('service_checks'),
    ],
  },
];

const BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`;

async function tableExists(db: SqlClient, table: string): Promise<boolean> {
  const sql = db.dialect.name === 'postgres'
    ? `SELECT 1 AS found FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`
    : `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = $1`;
  return (await db.query(sql, [table])).length > 0;
}

/** Brings the database to the latest schema version. Returns the versions it applied. */
export async function migrate(db: SqlClient): Promise<number[]> {
  await db.query(BOOKKEEPING);
  const rows = await db.query<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => Number(r.version)));
  const record = (m: Migration) => ({
    sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
    params: [m.version, m.name, new Date().toISOString()],
  });

  // A database created before migrations existed already has the baseline tables.
  if (applied.size === 0 && await tableExists(db, 'repos')) {
    await db.batch([record(MIGRATIONS[0])]);
    applied.add(MIGRATIONS[0].version);
  }

  const ran: number[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    await db.batch([
      ...migration.statements(db.dialect).map((sql) => ({ sql })),
      record(migration),
    ]);
    ran.push(migration.version);
  }
  return ran;
}

/**
 * Wraps a client so the first use runs the migrations, and every use waits
 * for them. Lets storage be created synchronously while setup is async.
 */
export function withMigrations(open: () => SqlClient | Promise<SqlClient>, dialect: Dialect): SqlClient {
  let ready: Promise<SqlClient> | undefined;
  const client = () => (ready ??= (async () => {
    const db = await open();
    await migrate(db);
    return db;
  })());

  return {
    dialect,
    query: async (sql, params) => (await client()).query(sql, params),
    queryOne: async (sql, params) => (await client()).queryOne(sql, params),
    batch: async (statements) => (await client()).batch(statements),
  };
}
