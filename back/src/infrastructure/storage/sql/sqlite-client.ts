/**
 * SqlClient over Node's built-in SQLite (`node:sqlite`, Node 22.13+).
 * No native dependency to install or compile. Node only.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { Row } from '../../../application/ports/storage';
import { sqliteDialect, type SqlClient, type Statement } from './client';

/** List/object columns are stored as JSON text; these names are parsed back on read. */
const JSON_COLUMNS = new Set(['blockers', 'topics', 'production_urls', 'summary', 'metadata', 'groups', 'data']);
const BOOLEAN_COLUMN = /^(is|has)_/;

// Loaded through require so bundlers and test runners that predate
// `node:sqlite` do not try to resolve it themselves.
const nodeRequire = createRequire(import.meta.url);

export function sqliteAvailable(): boolean {
  try {
    nodeRequire('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/** `$1` placeholders become SQLite's `?1`. */
function toSqlite(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?$1');
}

function encodeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

function decodeRow(raw: Record<string, unknown>): Row {
  const row: Row = {};
  for (const [column, value] of Object.entries(raw)) {
    if (value === null) row[column] = null;
    else if (BOOLEAN_COLUMN.test(column) && typeof value === 'number') row[column] = value !== 0;
    else if (JSON_COLUMNS.has(column) && typeof value === 'string') row[column] = JSON.parse(value);
    else if (typeof value === 'bigint') row[column] = Number(value);
    else row[column] = value;
  }
  return row;
}

/** Opens (creating if needed) a SQLite database. `path` may be ':memory:'. */
export function createSqliteClient(path: string): SqlClient & { close(): void } {
  const { DatabaseSync } = nodeRequire('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const run = (sql: string, params: unknown[] = []): Row[] => {
    const statement = database.prepare(toSqlite(sql));
    return (statement.all(...params.map(encodeParam)) as Record<string, unknown>[]).map(decodeRow);
  };

  return {
    dialect: sqliteDialect,
    async query<T = Row>(sql: string, params?: unknown[]) {
      return run(sql, params) as T[];
    },
    async queryOne<T = Row>(sql: string, params?: unknown[]) {
      return (run(sql, params)[0] as T) ?? null;
    },
    async batch(statements: Statement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(({ sql, params }) => run(sql, params));
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => database.close(),
  };
}
