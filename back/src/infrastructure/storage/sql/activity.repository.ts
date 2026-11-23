import type { SqlClient } from './client';
import type { ActivityParams } from '../../../types';
import { formatLogRow } from '../../../domain/activity';

export async function logActivity(db: SqlClient, params: ActivityParams) {
  const {
    action, entityType, entityId,
    fieldChanged = null, oldValue = null, newValue = null,
    actorType, actorName, metadata = {},
  } = params;

  const rows = await db.query(`
    INSERT INTO activity_log (
      action, entity_type, entity_id, field_changed,
      old_value, new_value, actor_type, actor_name, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    action, entityType, entityId, fieldChanged,
    oldValue != null ? String(oldValue) : null,
    newValue != null ? String(newValue) : null,
    actorType, actorName, JSON.stringify(metadata),
  ]);

  return formatLogRow(rows[0]);
}

// ── Query activities ────────────────────────────────

export async function listActivities(db: SqlClient, filters: {
  entityType?: string; entityId?: string;
  actorType?: string; actorName?: string;
  action?: string; limit: number; offset: number;
}) {
  const conditions: string[] = ['1=1'];
  const values: any[] = [];
  let paramIndex = 1;

  if (filters.entityType) { conditions.push(`entity_type = $${paramIndex}`); values.push(filters.entityType); paramIndex++; }
  if (filters.entityId) { conditions.push(`entity_id = $${paramIndex}`); values.push(filters.entityId); paramIndex++; }
  if (filters.actorType) { conditions.push(`actor_type = $${paramIndex}`); values.push(filters.actorType); paramIndex++; }
  if (filters.actorName) { conditions.push(`actor_name = $${paramIndex}`); values.push(filters.actorName); paramIndex++; }
  if (filters.action) { conditions.push(`action = $${paramIndex}`); values.push(filters.action); paramIndex++; }

  values.push(filters.limit, filters.offset);

  return db.query(`
    SELECT * FROM activity_log
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, values);
}

export async function getStatsByActor(db: SqlClient) {
  return db.query(`
    SELECT actor_type, actor_name,
      CAST(COUNT(*) AS INTEGER) as total_actions,
      CAST(COUNT(DISTINCT entity_id) AS INTEGER) as entities_touched,
      MAX(created_at) as last_activity
    FROM activity_log
    GROUP BY actor_type, actor_name
    ORDER BY total_actions DESC, actor_name
  `);
}

export async function getStatsByDay(db: SqlClient, days: number) {
  return db.query(`
    SELECT CAST(DATE(created_at) AS TEXT) as day, actor_type, actor_name, CAST(COUNT(*) AS INTEGER) as actions
    FROM activity_log
    WHERE created_at >= ${db.dialect.daysAgoTimestamp(days)}
    GROUP BY DATE(created_at), actor_type, actor_name
    ORDER BY day DESC, actions DESC, actor_name
  `);
}

export async function getActivityCount(db: SqlClient, entityType?: string, entityId?: string) {
  const conditions: string[] = ['1=1'];
  const values: any[] = [];
  let paramIndex = 1;

  if (entityType) { conditions.push(`entity_type = $${paramIndex}`); values.push(entityType); paramIndex++; }
  if (entityId) { conditions.push(`entity_id = $${paramIndex}`); values.push(entityId); paramIndex++; }

  const [row] = await db.query<{ count: string | number }>(`
    SELECT COUNT(*) as count FROM activity_log WHERE ${conditions.join(' AND ')}
  `, values);
  return Number(row?.count ?? 0);
}

export async function getActivitiesByEntity(db: SqlClient, entityType: string, entityId: string, limit: number) {
  return db.query(`
    SELECT * FROM activity_log
    WHERE entity_type = $1 AND entity_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
  `, [entityType, entityId, limit]);
}
