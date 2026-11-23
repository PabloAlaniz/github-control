import type { IncidentRow, UptimeDayRow } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

export async function recordCheck(
  db: SqlClient, slug: string, status: string, responseMs: number | null, httpCode: number | null, checkedAt?: string,
): Promise<void> {
  await db.query(`
    INSERT INTO service_checks (service_slug, status, response_ms, http_code, checked_at)
    VALUES ($1, $2, $3, $4, ${checkedAt ? '$5' : db.dialect.now})
  `, checkedAt ? [slug, status, responseMs, httpCode, isoTimestamp(checkedAt)] : [slug, status, responseMs, httpCode]);
}

export async function pruneChecks(db: SqlClient, keepDays: number): Promise<void> {
  await db.query(`DELETE FROM service_checks WHERE checked_at < ${db.dialect.daysAgoTimestamp(keepDays)}`);
}

export async function getDailyUptime(db: SqlClient, days: number): Promise<UptimeDayRow[]> {
  const rows = await db.query<UptimeDayRow>(`
    SELECT service_slug AS slug,
      CAST(DATE(checked_at) AS TEXT) AS day,
      CAST(COUNT(*) AS INTEGER) AS checks,
      CAST(SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS INTEGER) AS down,
      CAST(SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS INTEGER) AS degraded,
      CAST(ROUND(AVG(response_ms)) AS INTEGER) AS avg_ms
    FROM service_checks
    WHERE checked_at >= ${db.dialect.daysAgoTimestamp(days)}
    GROUP BY service_slug, DATE(checked_at)
    ORDER BY service_slug, DATE(checked_at)
  `);
  return rows.map((row) => ({ ...row, avg_ms: row.avg_ms === null ? null : Number(row.avg_ms) }));
}

export async function getIncidents(db: SqlClient, days: number): Promise<IncidentRow[]> {
  const rows = await db.query<IncidentRow>(`
    SELECT slug,
      CAST(SUM(CASE WHEN status = 'down' AND (prev_status IS NULL OR prev_status <> 'down') THEN 1 ELSE 0 END) AS INTEGER) AS incidents,
      MAX(CASE WHEN status = 'down' THEN checked_at END) AS last_down_at
    FROM (
      SELECT service_slug AS slug, status, checked_at,
        LAG(status) OVER (PARTITION BY service_slug ORDER BY checked_at, id) AS prev_status
      FROM service_checks
      WHERE checked_at >= ${db.dialect.daysAgoTimestamp(days)}
    ) history
    GROUP BY slug
    HAVING SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) > 0
    ORDER BY slug
  `);
  return rows.map((row) => ({ ...row, last_down_at: isoTimestamp(row.last_down_at) }));
}
