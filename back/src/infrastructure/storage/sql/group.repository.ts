import type { SqlClient } from './client';
import { activeRepoConditions } from './filters';

export async function listGroups(db: SqlClient) {
  const conds = activeRepoConditions({}, 'r');
  const activeFilter = conds.length > 0 ? ` AND ${conds.join(' AND ')}` : '';

  return db.query(`
    SELECT g.*,
      CAST(COUNT(rg.repo_id) FILTER (WHERE r.id IS NOT NULL${activeFilter}) AS INTEGER) as repo_count
    FROM groups g
    LEFT JOIN repo_groups rg ON g.id = rg.group_id
    LEFT JOIN repos r ON rg.repo_id = r.id
    GROUP BY g.id
    ORDER BY g.name
  `);
}

export async function createGroup(db: SqlClient, slug: string, name: string, description?: string, color?: string) {
  return db.queryOne<{ id: number }>(`
    INSERT INTO groups (slug, name, description, color)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [slug, name, description, color || '#6366f1']);
}

export async function updateGroup(db: SqlClient, id: number, slug: string, name: string, description?: string, color?: string): Promise<void> {
  await db.query(`
    UPDATE groups SET slug = $1, name = $2, description = $3, color = $4
    WHERE id = $5
  `, [slug, name, description, color, id]);
}

export async function deleteGroup(db: SqlClient, id: number): Promise<void> {
  await db.query(`DELETE FROM groups WHERE id = $1`, [id]);
}

export async function getRepoId(db: SqlClient, fullName: string) {
  return db.queryOne<{ id: number }>(`SELECT id FROM repos WHERE full_name = $1`, [fullName]);
}

export async function addRepoToGroup(db: SqlClient, repoId: number, groupId: number): Promise<void> {
  await db.query(`
    INSERT INTO repo_groups (repo_id, group_id)
    VALUES ($1, $2)
    ON CONFLICT DO NOTHING
  `, [repoId, groupId]);
}

export async function removeRepoFromGroup(db: SqlClient, repoId: number, groupId: number): Promise<void> {
  await db.query(`DELETE FROM repo_groups WHERE repo_id = $1 AND group_id = $2`, [repoId, groupId]);
}

/**
 * Lists all (repo_full_name, group_slug) edges. Used by /api/export.
 */
export async function listAllRepoGroupEdges(db: SqlClient) {
  return db.query<{ repo_full_name: string; group_slug: string }>(`
    SELECT r.full_name AS repo_full_name, g.slug AS group_slug
    FROM repo_groups rg
    JOIN repos r ON r.id = rg.repo_id
    JOIN groups g ON g.id = rg.group_id
    ORDER BY r.full_name, g.slug
  `);
}

/** Upsert a group by slug. Returns the resulting id. */
export async function upsertGroupBySlug(
  db: SqlClient,
  slug: string,
  name: string,
  description?: string | null,
  color?: string | null,
) {
  return db.queryOne<{ id: number }>(`
    INSERT INTO groups (slug, name, description, color)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      color = COALESCE(EXCLUDED.color, groups.color)
    RETURNING id
  `, [slug, name, description ?? null, color ?? '#6366f1']);
}
