import type { Alert, AlertInput, AlertStatus } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

const COLUMNS = 'id, key, kind, entity, title, detail, url, level, status, opened_at, resolved_at';
const DEFAULT_LIMIT = 200;

function toAlert(row: Alert): Alert {
  return {
    ...row,
    detail: row.detail ?? {},
    opened_at: isoTimestamp(row.opened_at)!,
    resolved_at: isoTimestamp(row.resolved_at),
  };
}

export async function listAlerts(
  db: SqlClient, options: { status?: AlertStatus; limit?: number } = {},
): Promise<Alert[]> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT));
  const rows = options.status
    ? await db.query<Alert>(
      `SELECT ${COLUMNS} FROM alerts WHERE status = $1 ORDER BY opened_at DESC, id DESC LIMIT ${limit}`, [options.status])
    : await db.query<Alert>(`SELECT ${COLUMNS} FROM alerts ORDER BY opened_at DESC, id DESC LIMIT ${limit}`);
  return rows.map(toAlert);
}

export async function openAlert(db: SqlClient, input: AlertInput): Promise<Alert> {
  const row = await db.queryOne<Alert>(`
    INSERT INTO alerts (key, kind, entity, title, detail, url, level)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING ${COLUMNS}
  `, [input.key, input.kind, input.entity, input.title, JSON.stringify(input.detail), input.url, input.level]);
  return toAlert(row!);
}

export async function updateAlert(
  db: SqlClient, id: number, fields: Pick<AlertInput, 'title' | 'detail' | 'url' | 'level'>,
): Promise<void> {
  await db.query(
    `UPDATE alerts SET title = $1, detail = $2, url = $3, level = $4 WHERE id = $5`,
    [fields.title, JSON.stringify(fields.detail), fields.url, fields.level, id],
  );
}

export async function resolveAlert(db: SqlClient, id: number): Promise<void> {
  await db.query(
    `UPDATE alerts SET status = 'resolved', resolved_at = ${db.dialect.now} WHERE id = $1 AND status = 'open'`, [id],
  );
}

export async function pruneResolved(db: SqlClient, keepDays: number): Promise<void> {
  await db.query(
    `DELETE FROM alerts WHERE status = 'resolved' AND resolved_at < ${db.dialect.daysAgoTimestamp(keepDays)}`,
  );
}
