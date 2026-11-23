import { isoTimestamp, type SqlClient } from './client';
import { activeRepoConditions } from './filters';
import { PATCHABLE_META_FIELDS } from '../../../domain/repos';
import { columnType, isRepoColumn } from '../schema';

/** Encodes a value for the column it goes into (lists, JSON and timestamps need it). */
function encodeRepoValue(db: SqlClient, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (column === 'blockers') return db.dialect.listParam(value as string[]);
  const type = columnType('repos', column);
  if (type === 'json') return JSON.stringify(value);
  if (type === 'timestamp') return isoTimestamp(value);
  return value;
}

export async function getMetaSummary(db: SqlClient) {
  const conds = activeRepoConditions({}, '');
  const activeWhere = conds.length > 0 ? ` AND ${conds.join(' AND ')}` : '';

  const priorities = await db.query<{ priority: string; count: number }>(`
    SELECT priority, CAST(COUNT(*) AS INTEGER) as count
    FROM repos WHERE priority IS NOT NULL${activeWhere}
    GROUP BY priority
    ORDER BY priority
  `);

  const stacks = await db.query<{ stack: string; count: number }>(`
    SELECT stack, CAST(COUNT(*) AS INTEGER) as count
    FROM repos WHERE stack IS NOT NULL${activeWhere}
    GROUP BY stack
    ORDER BY stack
  `);

  return { priorities, stacks };
}

export async function getRepoMeta(db: SqlClient, fullName: string) {
  return db.queryOne(`
    SELECT priority, next_action, blockers, client, notes, production_urls
    FROM repos WHERE full_name = $1
  `, [fullName]);
}

export async function patchRepoMeta(db: SqlClient, fullName: string, updates: Record<string, any>) {
  const allowedFields: readonly string[] = PATCHABLE_META_FIELDS;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(encodeRepoValue(db, key, value));
    }
  }

  if (setClauses.length === 0) return false;

  values.push(fullName);
  await db.query(`
    UPDATE repos SET ${setClauses.join(', ')}
    WHERE full_name = $${paramIndex}
  `, values);
  return true;
}

export async function bulkUpdateMeta(db: SqlClient, updates: { full_name: string;[key: string]: any }[]) {
  for (const { full_name, ...meta } of updates) {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(meta)) {
      // Column names are interpolated into the SQL below: only real columns may pass.
      if (!isRepoColumn(key)) throw new Error(`Unknown repo field: ${key}`);
      setClauses.push(`${key} = $${paramIndex++}`);
      values.push(encodeRepoValue(db, key, value));
    }

    if (setClauses.length > 0) {
      values.push(full_name);
      await db.query(`
        UPDATE repos SET ${setClauses.join(', ')}
        WHERE full_name = $${paramIndex}
      `, values);
    }
  }
}
