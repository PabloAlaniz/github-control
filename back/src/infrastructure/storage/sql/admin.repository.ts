/** Whole-database export and import for the SQL adapter, driven by the logical schema. */
import type { Row, StorageDump } from '../../../application/ports/storage';
import { COLLECTIONS, columnType, columnsOf, type CollectionName } from '../schema';
import { isoTimestamp, type SqlClient, type Statement } from './client';

const NAMES = Object.keys(COLLECTIONS) as CollectionName[];
/** repo_groups references repos and groups: delete it first, fill it last. */
const DELETE_ORDER = [...NAMES].sort((a, b) => Number(b === 'repo_groups') - Number(a === 'repo_groups'));
const INSERT_ORDER = [...DELETE_ORDER].reverse();
/** Parameters per INSERT, well under the limit of either engine. */
const MAX_PARAMS = 5000;

function selectList(collection: CollectionName): string {
  return columnsOf(collection)
    // Calendar dates as text, so they do not come back as timestamps.
    .map((column) => (columnType(collection, column) === 'date' ? `CAST(${column} AS TEXT) AS ${column}` : column))
    .join(', ');
}

function orderBy(collection: CollectionName): string {
  return columnsOf(collection).includes('id') ? 'id' : columnsOf(collection).slice(0, 2).join(', ');
}

function encode(db: SqlClient, collection: CollectionName, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (column === 'blockers') return db.dialect.listParam(value as string[]);
  const type = columnType(collection, column);
  if (type === 'json') return JSON.stringify(value);
  if (type === 'timestamp') return isoTimestamp(value);
  return value;
}

export async function exportAll(db: SqlClient): Promise<StorageDump> {
  const dump: StorageDump = {};
  for (const collection of NAMES) {
    const rows = await db.query(`SELECT ${selectList(collection)} FROM ${collection} ORDER BY ${orderBy(collection)}`);
    // Round-trip through JSON so driver-specific values (Date) become plain ones.
    dump[collection] = JSON.parse(JSON.stringify(rows)) as Row[];
  }
  return dump;
}

export async function importAll(db: SqlClient, dump: StorageDump): Promise<void> {
  const statements: Statement[] = DELETE_ORDER.map((collection) => ({ sql: `DELETE FROM ${collection}` }));

  for (const collection of INSERT_ORDER) {
    const rows = dump[collection] ?? [];
    if (rows.length === 0) continue;
    // Only columns present in the data: absent ones take the schema default.
    const columns = columnsOf(collection).filter((column) => rows.some((row) => column in row));
    const perChunk = Math.max(1, Math.floor(MAX_PARAMS / columns.length));

    for (let start = 0; start < rows.length; start += perChunk) {
      const chunk = rows.slice(start, start + perChunk);
      const tuples = chunk.map((_, i) =>
        `(${columns.map((__, j) => `$${i * columns.length + j + 1}`).join(', ')})`);
      statements.push({
        sql: `INSERT INTO ${collection} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
        params: chunk.flatMap((row) => columns.map((column) => encode(db, collection, column, row[column]))),
      });
    }
  }

  if (db.dialect.name === 'postgres') {
    // Explicit ids do not advance a serial sequence: move it past the imported ids.
    for (const collection of NAMES) {
      if (!columnsOf(collection).includes('id')) continue;
      statements.push({
        sql: `SELECT setval(pg_get_serial_sequence('${collection}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${collection}), 1), (SELECT MAX(id) FROM ${collection}) IS NOT NULL)`,
      });
    }
  }

  await db.batch(statements);
}
