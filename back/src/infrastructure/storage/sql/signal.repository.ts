import type { SignalRecord } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

const COLUMNS = 'full_name, kind, data, checked_at';

function toRecord(row: SignalRecord): SignalRecord {
  return { full_name: row.full_name, kind: row.kind, data: row.data ?? {}, checked_at: isoTimestamp(row.checked_at)! };
}

export async function upsertSignal(
  db: SqlClient, fullName: string, kind: string, data: Record<string, unknown>,
): Promise<SignalRecord | null> {
  // Selecting from repos makes the insert a no-op for repos the store does not know.
  const row = await db.queryOne<SignalRecord>(`
    INSERT INTO repo_signals (full_name, kind, data, checked_at)
    SELECT full_name, $2, $3, ${db.dialect.now} FROM repos WHERE full_name = $1
    ON CONFLICT (full_name, kind) DO UPDATE SET
      data = EXCLUDED.data,
      checked_at = EXCLUDED.checked_at
    RETURNING ${COLUMNS}
  `, [fullName, kind, JSON.stringify(data)]);
  return row ? toRecord(row) : null;
}

export async function getRepoSignals(db: SqlClient, fullName: string): Promise<SignalRecord[]> {
  const rows = await db.query<SignalRecord>(
    `SELECT ${COLUMNS} FROM repo_signals WHERE full_name = $1 ORDER BY kind`, [fullName],
  );
  return rows.map(toRecord);
}

export async function listSignals(db: SqlClient, kind?: string): Promise<SignalRecord[]> {
  const rows = kind
    ? await db.query<SignalRecord>(`SELECT ${COLUMNS} FROM repo_signals WHERE kind = $1 ORDER BY full_name, kind`, [kind])
    : await db.query<SignalRecord>(`SELECT ${COLUMNS} FROM repo_signals ORDER BY full_name, kind`);
  return rows.map(toRecord);
}
