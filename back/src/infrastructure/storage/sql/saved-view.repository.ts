import type { SavedView } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

const COLUMNS = 'id, name, query, created_at, updated_at';

function toView(row: SavedView): SavedView {
  return { ...row, created_at: isoTimestamp(row.created_at)!, updated_at: isoTimestamp(row.updated_at)! };
}

export async function listSavedViews(db: SqlClient): Promise<SavedView[]> {
  const rows = await db.query<SavedView>(`SELECT ${COLUMNS} FROM saved_views ORDER BY LOWER(name), name`);
  return rows.map(toView);
}

export async function upsertSavedView(db: SqlClient, name: string, query: string): Promise<SavedView> {
  const row = await db.queryOne<SavedView>(`
    INSERT INTO saved_views (name, query)
    VALUES ($1, $2)
    ON CONFLICT (name) DO UPDATE SET
      query = EXCLUDED.query,
      updated_at = ${db.dialect.now}
    RETURNING ${COLUMNS}
  `, [name, query]);
  return toView(row!);
}

export async function deleteSavedView(db: SqlClient, id: number): Promise<boolean> {
  const rows = await db.query(`DELETE FROM saved_views WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}
