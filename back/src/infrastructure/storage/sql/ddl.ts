/**
 * Builds the database schema for either engine from the logical schema in
 * `../schema.ts`, so the tables of every SQL database and the records of the
 * file stores come from one definition.
 */
import {
  ALLOWED_VALUES, COLLECTIONS, NOW, columnType, columnsOf, type CollectionName, type ColumnType,
} from '../schema';
import type { Dialect } from './client';

/** Unique keys per collection (the first one of `repo_groups` is its primary key). */
const UNIQUE_KEYS: Record<CollectionName, string[][]> = {
  repos: [['full_name']],
  groups: [['slug']],
  repo_groups: [['repo_id', 'group_id']],
  services: [['slug']],
  repo_apps: [['slug'], ['repo_full_name', 'app_path']],
  repo_metrics_history: [['repo_id', 'snapshot_date']],
  coverage_reports: [['repo_full_name', 'label']],
  activity_log: [],
  repo_traffic_daily: [['full_name', 'day']],
  repo_traffic_sources: [['full_name', 'day', 'kind', 'label']],
  saved_views: [['name']],
  repo_signals: [['full_name', 'kind']],
  service_checks: [],
  alerts: [],
  alert_channels: [],
};

const HAS_UPDATED_AT: CollectionName[] = ['repos', 'groups', 'services', 'repo_apps'];

const INDEXES: [CollectionName, string][] = [
  ['repos', 'priority'], ['repos', 'is_deleted'], ['repos', 'repo_updated_at'],
  ['repo_metrics_history', 'full_name'], ['repo_metrics_history', 'snapshot_date'],
  ['activity_log', 'created_at'], ['activity_log', 'entity_id'],
  ['services', 'source_repo_full_name'], ['repo_apps', 'repo_full_name'],
  ['repo_groups', 'group_id'],
  ['service_checks', 'service_slug'], ['service_checks', 'checked_at'],
  ['alerts', 'status'], ['alerts', 'opened_at'],
];

/** `CREATE INDEX IF NOT EXISTS` for the indexed columns of one table (for migrations after the baseline). */
export function createIndexes(collection: CollectionName): string[] {
  return INDEXES
    .filter(([table]) => table === collection)
    .map(([table, column]) => `CREATE INDEX IF NOT EXISTS idx_${table}_${column} ON ${table} (${column})`);
}

const TYPES: Record<Dialect['name'], Record<ColumnType, string>> = {
  postgres: { text: 'TEXT', int: 'INTEGER', bool: 'BOOLEAN', json: 'JSONB', timestamp: 'TIMESTAMPTZ', date: 'DATE' },
  sqlite: { text: 'TEXT', int: 'INTEGER', bool: 'INTEGER', json: 'TEXT', timestamp: 'TEXT', date: 'TEXT' },
};

function sqlLiteral(value: unknown, type: ColumnType, dialect: Dialect, column: string): string {
  if (value === NOW) return dialect.name === 'postgres' ? 'NOW()' : `(${dialect.now})`;
  if (type === 'json') {
    if (column === 'blockers' && dialect.name === 'postgres') return "'{}'";
    return `'${JSON.stringify(value)}'`;
  }
  if (type === 'bool') return dialect.name === 'postgres' ? String(value) : (value ? '1' : '0');
  if (type === 'int') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function columnDefinition(collection: CollectionName, column: string, dialect: Dialect): string {
  const type = columnType(collection, column);
  if (column === 'id') {
    return dialect.name === 'postgres' ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  }
  // The one list column: a native array in Postgres, JSON text in SQLite.
  const sqlType = column === 'blockers' && dialect.name === 'postgres' ? 'TEXT[]' : TYPES[dialect.name][type];
  const fallback = (COLLECTIONS[collection] as Record<string, unknown>)[column];
  const parts = [column, sqlType];
  if (fallback !== null && fallback !== undefined) parts.push(`DEFAULT ${sqlLiteral(fallback, type, dialect, column)}`);

  const allowed = collection === 'repos' ? ALLOWED_VALUES[column] : undefined;
  if (allowed) parts.push(`CHECK (${column} IN (${allowed.map((v) => `'${v}'`).join(', ')}))`);
  if (collection === 'coverage_reports' && column === 'coverage') parts.push('CHECK (coverage >= 0 AND coverage <= 100)');
  return parts.join(' ');
}

export function createTable(collection: CollectionName, dialect: Dialect): string {
  const lines = columnsOf(collection).map((column) => columnDefinition(collection, column, dialect));
  const [first, ...rest] = UNIQUE_KEYS[collection];
  if (collection === 'repo_groups') {
    lines.push(`PRIMARY KEY (${first.join(', ')})`);
    lines.push('FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE');
    lines.push('FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE');
  } else if (first) {
    lines.push(`UNIQUE (${first.join(', ')})`);
  }
  for (const key of rest) lines.push(`UNIQUE (${key.join(', ')})`);
  return `CREATE TABLE IF NOT EXISTS ${collection} (\n  ${lines.join(',\n  ')}\n)`;
}

function updatedAtTriggers(dialect: Dialect): string[] {
  if (dialect.name === 'postgres') {
    return [
      `CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$`,
      ...HAS_UPDATED_AT.map((table) =>
        `CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION update_updated_at()`),
    ];
  }
  // SQLite: recursive triggers are off by default, so the inner UPDATE does not re-fire.
  return HAS_UPDATED_AT.map((table) =>
    `CREATE TRIGGER ${table}_updated_at AFTER UPDATE ON ${table} FOR EACH ROW
BEGIN
  UPDATE ${table} SET updated_at = ${dialect.now} WHERE id = NEW.id;
END`);
}

/**
 * Every statement needed to create the schema from scratch, in order.
 *
 * It reflects the *current* schema, so a brand-new database gets everything at
 * version 1. Later migrations therefore have to be idempotent (CREATE TABLE IF
 * NOT EXISTS, guarded ALTERs): on a new database they find their work done.
 */
export function baselineStatements(dialect: Dialect): string[] {
  const tables = (Object.keys(COLLECTIONS) as CollectionName[])
    // repo_groups references repos and groups: create it after them.
    .sort((a, b) => Number(a === 'repo_groups') - Number(b === 'repo_groups'));
  return [
    ...tables.map((collection) => createTable(collection, dialect)),
    ...INDEXES.map(([table, column]) => `CREATE INDEX idx_${table}_${column} ON ${table} (${column})`),
    ...updatedAtTriggers(dialect),
  ];
}
