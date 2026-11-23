import type { TrafficDay, TrafficSource, TrafficSourceKind } from '../../../application/ports/storage';
import type { SqlClient } from './client';

const COUNTS = ['views', 'views_unique', 'clones', 'clones_unique'] as const;
const sums = COUNTS.map((column) => `CAST(COALESCE(SUM(${column}), 0) AS INTEGER) AS ${column}`).join(', ');

export async function upsertDaily(db: SqlClient, fullName: string, days: TrafficDay[]): Promise<void> {
  if (days.length === 0) return;
  await db.batch(days.map((d) => ({
    sql: `
      INSERT INTO repo_traffic_daily (full_name, day, views, views_unique, clones, clones_unique, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6, ${db.dialect.now})
      ON CONFLICT (full_name, day) DO UPDATE SET
        views = EXCLUDED.views, views_unique = EXCLUDED.views_unique,
        clones = EXCLUDED.clones, clones_unique = EXCLUDED.clones_unique,
        fetched_at = ${db.dialect.now}
    `,
    params: [fullName, d.day, d.views, d.views_unique, d.clones, d.clones_unique],
  })));
}

export async function replaceSources(
  db: SqlClient, fullName: string, day: string, kind: TrafficSourceKind, sources: TrafficSource[],
): Promise<void> {
  await db.batch([
    { sql: `DELETE FROM repo_traffic_sources WHERE full_name = $1 AND day = $2 AND kind = $3`, params: [fullName, day, kind] },
    ...sources.map((s) => ({
      sql: `
        INSERT INTO repo_traffic_sources (full_name, day, kind, label, title, hits, uniques)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      params: [fullName, day, kind, s.label, s.title ?? null, s.hits, s.uniques],
    })),
  ]);
}

export async function getDaily(db: SqlClient, fullName: string, days: number) {
  return db.query<TrafficDay>(`
    SELECT CAST(day AS TEXT) AS day, views, views_unique, clones, clones_unique
    FROM repo_traffic_daily
    WHERE full_name = $1 AND day >= ${db.dialect.daysAgoDate(days)}
    ORDER BY day
  `, [fullName]);
}

export async function getDailyTotals(db: SqlClient, days: number) {
  return db.query<TrafficDay>(`
    SELECT CAST(day AS TEXT) AS day, ${sums}
    FROM repo_traffic_daily
    WHERE day >= ${db.dialect.daysAgoDate(days)}
    GROUP BY day
    ORDER BY day
  `);
}

export async function getTotalsByRepo(db: SqlClient, days: number) {
  return db.query<Omit<TrafficDay, 'day'> & { full_name: string }>(`
    SELECT full_name, ${sums}
    FROM repo_traffic_daily
    WHERE day >= ${db.dialect.daysAgoDate(days)}
    GROUP BY full_name
    ORDER BY views DESC, full_name
  `);
}

export async function getSources(db: SqlClient, fullName: string, kind: TrafficSourceKind) {
  const rows = await db.query<TrafficSource & { day: string }>(`
    SELECT CAST(day AS TEXT) AS day, label, title, hits, uniques
    FROM repo_traffic_sources
    WHERE full_name = $1 AND kind = $2
      AND day = (SELECT MAX(day) FROM repo_traffic_sources WHERE full_name = $1 AND kind = $2)
    ORDER BY hits DESC, label
  `, [fullName, kind]);
  return {
    day: rows[0]?.day ?? null,
    sources: rows.map(({ label, title, hits, uniques }) => ({ label, title, hits, uniques })),
  };
}
