/**
 * In-memory database: plain arrays of records plus the few rules a SQL
 * engine would enforce (defaults, ids, unique keys, allowed values,
 * `updated_at`). The whole state is one JSON-serializable object, which is
 * what the JSON and CSV file stores persist.
 */
import type { Row } from '../../../application/ports/storage';
import { ALLOWED_VALUES, COLLECTIONS, NOW, type CollectionName } from '../schema';

export type MemoryState = { [K in CollectionName]: Row[] } & {
  /** Last id handed out per collection. */
  seq: Partial<Record<CollectionName, number>>;
};

export interface MemoryOptions {
  /** Clock override (tests). */
  now?: () => Date;
  /** Called after every write with the collections it touched; file-backed stores persist here. */
  onChange?: (state: MemoryState, changed: ReadonlySet<CollectionName>) => void | Promise<void>;
}

export function emptyState(): MemoryState {
  const state = { seq: {} } as MemoryState;
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) state[name] = [];
  return state;
}

const TIMESTAMP_COLUMN = /_at$|^last_health_check$|^last_docs_check$|^last_deep_analysis$/;
const HAS_UPDATED_AT = new Set<CollectionName>(['repos', 'groups', 'services', 'repo_apps']);

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'YYYY-MM-DD' shifted by `days` (UTC). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class MemoryDb {
  readonly state: MemoryState;
  private readonly options: MemoryOptions;
  private changed = new Set<CollectionName>();

  constructor(state: MemoryState = emptyState(), options: MemoryOptions = {}) {
    this.state = state;
    this.options = options;
  }

  /** Current instant as an ISO string. */
  now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  /** Current UTC date, 'YYYY-MM-DD'. */
  today(): string {
    return this.now().slice(0, 10);
  }

  table(name: CollectionName): Row[] {
    return this.state[name];
  }

  /** Persists pending changes. Every write method awaits this before returning. */
  async commit(): Promise<void> {
    if (this.changed.size === 0) return;
    const changed = this.changed;
    this.changed = new Set();
    await this.options.onChange?.(this.state, changed);
  }

  /** Inserts a record built from the collection defaults plus `values`. */
  insert(name: CollectionName, values: Row): Row {
    const defaults = COLLECTIONS[name] as Record<string, unknown>;
    const now = this.now();
    const row: Row = {};
    for (const [column, fallback] of Object.entries(defaults)) {
      row[column] = fallback === NOW ? now : clone(fallback);
    }
    if ('id' in defaults) {
      const id = (this.state.seq[name] ?? 0) + 1;
      this.state.seq[name] = id;
      row.id = id;
    }
    this.assign(name, row, values);
    this.table(name).push(row);
    this.changed.add(name);
    return row;
  }

  /** Applies `values` to an existing record and bumps `updated_at`. */
  update(name: CollectionName, row: Row, values: Row): void {
    this.assign(name, row, values);
    if (HAS_UPDATED_AT.has(name)) row.updated_at = this.now();
    this.changed.add(name);
  }

  /** Replaces the content of a collection wholesale (imports). */
  replace(name: CollectionName, rows: Row[]): void {
    this.state[name] = rows;
    if ('id' in COLLECTIONS[name]) {
      this.state.seq[name] = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
    }
    this.changed.add(name);
  }

  remove(name: CollectionName, predicate: (row: Row) => boolean): Row[] {
    const table = this.table(name);
    const removed: Row[] = [];
    for (let i = table.length - 1; i >= 0; i--) {
      if (predicate(table[i])) removed.unshift(...table.splice(i, 1));
    }
    if (removed.length > 0) this.changed.add(name);
    return removed;
  }

  private assign(name: CollectionName, row: Row, values: Row): void {
    for (const [column, raw] of Object.entries(values)) {
      if (raw === undefined) continue;
      let value = raw;
      if (value !== null && TIMESTAMP_COLUMN.test(column)) {
        value = new Date(value as string).toISOString();
      }
      if (name === 'repos' && value !== null && ALLOWED_VALUES[column]
        && !ALLOWED_VALUES[column].includes(value as string)) {
        throw new Error(`Invalid value "${String(value)}" for ${column}`);
      }
      row[column] = clone(value);
    }
  }
}

/** Raised for the conflicts a SQL unique constraint would reject. */
export function uniqueViolation(constraint: string): Error {
  return new Error(`duplicate key value violates unique constraint "${constraint}"`);
}
