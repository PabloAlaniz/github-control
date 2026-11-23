/**
 * What the SQL stores need from a database connection, and the few places
 * where Postgres and SQLite spell things differently.
 *
 * The stores write one SQL text for both engines, using `$1`-style
 * placeholders and standard syntax; anything engine-specific goes through
 * `db.dialect`.
 */
import type { Row } from '../../../application/ports/storage';

export interface Statement {
  sql: string;
  params?: unknown[];
}

export interface SqlClient {
  readonly dialect: Dialect;
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Runs the statements in one transaction and returns the rows of each. */
  batch(statements: Statement[]): Promise<Row[][]>;
}

export interface Dialect {
  readonly name: 'postgres' | 'sqlite';
  /** Current timestamp. */
  readonly now: string;
  /** Current UTC date. */
  readonly today: string;
  /** The date `days` days before today. */
  daysAgoDate(days: number): string;
  /** The instant `days` days before now. */
  daysAgoTimestamp(days: number): string;
  /** Aggregates the non-null values of `expr` into a list (empty list when none). */
  listAgg(expr: string): string;
  /** Encodes a list of strings as a parameter for a list column. */
  listParam(values: string[]): unknown;
}

function assertDays(days: number): number {
  if (!Number.isInteger(days) || days < 0) throw new Error(`Invalid number of days: ${days}`);
  return days;
}

export const postgresDialect: Dialect = {
  name: 'postgres',
  now: 'NOW()',
  today: 'CURRENT_DATE',
  daysAgoDate: (days) => `(CURRENT_DATE - ${assertDays(days)})`,
  daysAgoTimestamp: (days) => `(NOW() - INTERVAL '${assertDays(days)} days')`,
  listAgg: (expr) => `COALESCE(array_agg(${expr}) FILTER (WHERE ${expr} IS NOT NULL), '{}')`,
  listParam: (values) => values,
};

/** ISO-8601 with milliseconds and Z: the same text JavaScript's toISOString() produces. */
const SQLITE_ISO = "'%Y-%m-%dT%H:%M:%fZ'";

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  now: `strftime(${SQLITE_ISO}, 'now')`,
  today: "date('now')",
  daysAgoDate: (days) => `date('now', '-${assertDays(days)} days')`,
  daysAgoTimestamp: (days) => `strftime(${SQLITE_ISO}, 'now', '-${assertDays(days)} days')`,
  listAgg: (expr) => `json_group_array(${expr}) FILTER (WHERE ${expr} IS NOT NULL)`,
  listParam: (values) => JSON.stringify(values),
};

/** Normalizes a timestamp given as Date or text to ISO-8601 (null stays null). */
export function isoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value as string | Date);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${String(value)}`);
  return date.toISOString();
}
