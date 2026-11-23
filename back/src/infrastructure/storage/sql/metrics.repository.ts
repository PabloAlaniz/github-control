import type { SqlClient } from './client';
import type { SnapshotInput } from '../../../lib/metrics/types';
import { upsertSnapshotSql, snapshotParams } from '../../../lib/metrics/snapshot-sql';

// ── Reads ──────────────────────────────────────────

export async function getRepoMetrics(db: SqlClient, fullName: string, days: number) {
  return db.query(`
    SELECT CAST(snapshot_date AS TEXT) AS snapshot_date, repo_size_kb, file_count, loc,
      stars, forks, watchers, subscribers_count, open_issues,
      has_ci, has_tests, has_readme, readme_lines, docs_quality, docs_file_count
    FROM repo_metrics_history
    WHERE full_name = $1 AND snapshot_date >= ${db.dialect.daysAgoDate(days)}
    ORDER BY snapshot_date ASC
  `, [fullName]);
}

export async function getSnapshot(db: SqlClient, date: string) {
  return db.query(`
    SELECT full_name, CAST(snapshot_date AS TEXT) AS snapshot_date, repo_size_kb, file_count, loc,
      stars, forks, watchers, subscribers_count, open_issues,
      has_ci, has_tests, has_readme, readme_lines, docs_quality, docs_file_count,
      language, is_private, is_archived
    FROM repo_metrics_history
    WHERE snapshot_date = $1
    ORDER BY full_name ASC
  `, [date]);
}

export async function getAggregate(db: SqlClient, days: number) {
  return db.query(`
    SELECT CAST(snapshot_date AS TEXT) AS snapshot_date,
      CAST(COUNT(*) AS INTEGER) as total_repos,
      CAST(SUM(loc) AS DOUBLE PRECISION) as total_loc, CAST(SUM(file_count) AS DOUBLE PRECISION) as total_files,
      CAST(SUM(repo_size_kb) AS DOUBLE PRECISION) as total_size_kb,
      CAST(SUM(stars) AS DOUBLE PRECISION) as total_stars, CAST(SUM(forks) AS DOUBLE PRECISION) as total_forks,
      CAST(SUM(open_issues) AS DOUBLE PRECISION) as total_open_issues,
      CAST(COUNT(*) FILTER (WHERE has_ci = true) AS INTEGER) as repos_with_ci,
      CAST(COUNT(*) FILTER (WHERE has_tests = true) AS INTEGER) as repos_with_tests,
      CAST(COUNT(*) FILTER (WHERE has_readme = true) AS INTEGER) as repos_with_readme,
      CAST(COUNT(*) FILTER (WHERE docs_quality = 'excellent') AS INTEGER) as repos_docs_excellent,
      CAST(COUNT(*) FILTER (WHERE docs_quality = 'good') AS INTEGER) as repos_docs_good,
      CAST(COUNT(*) FILTER (WHERE docs_quality = 'needs_work') AS INTEGER) as repos_docs_needs_work,
      CAST(COUNT(*) FILTER (WHERE docs_quality = 'missing') AS INTEGER) as repos_docs_missing
    FROM repo_metrics_history
    WHERE snapshot_date >= ${db.dialect.daysAgoDate(days)} AND is_archived = false
    GROUP BY snapshot_date
    ORDER BY snapshot_date ASC
  `);
}

/**
 * Returns one row per repo with the latest snapshot's metrics minus the
 * most-recent snapshot taken on/before (now - days). Null prev when not enough history.
 */
export async function getBulkTrends(db: SqlClient, days: number) {
  return db.query<{
    full_name: string;
    loc_delta: number | null;
    stars_delta: number | null;
    open_issues_delta: number | null;
    current_loc: number | null;
    prev_loc: number | null;
    period_days: number;
  }>(`
    SELECT
      l.full_name,
      l.loc - p.loc AS loc_delta,
      l.stars - p.stars AS stars_delta,
      l.open_issues - p.open_issues AS open_issues_delta,
      l.loc AS current_loc,
      p.loc AS prev_loc,
      ${days} AS period_days
    FROM (
      SELECT full_name, loc, stars, open_issues,
        ROW_NUMBER() OVER (PARTITION BY full_name ORDER BY snapshot_date DESC) AS rn
      FROM repo_metrics_history
    ) l
    LEFT JOIN (
      SELECT full_name, loc, stars, open_issues,
        ROW_NUMBER() OVER (PARTITION BY full_name ORDER BY snapshot_date DESC) AS rn
      FROM repo_metrics_history
      WHERE snapshot_date <= ${db.dialect.daysAgoDate(days)}
    ) p ON p.full_name = l.full_name AND p.rn = 1
    WHERE l.rn = 1
    ORDER BY l.full_name
  `);
}

export async function getLatestSnapshotDate(db: SqlClient) {
  const [row] = await db.query<{ latest: string | null }>(`
    SELECT CAST(MAX(snapshot_date) AS TEXT) AS latest FROM repo_metrics_history
  `);
  return row?.latest ?? null;
}

export async function compareSnapshots(db: SqlClient, from: string, to: string) {
  return db.query(`
    WITH from_snapshot AS (
      SELECT full_name, loc, file_count, repo_size_kb, stars, forks, open_issues
      FROM repo_metrics_history WHERE snapshot_date = $1
    ),
    to_snapshot AS (
      SELECT full_name, loc, file_count, repo_size_kb, stars, forks, open_issues
      FROM repo_metrics_history WHERE snapshot_date = $2
    ),
    first_seen AS (
      SELECT full_name, MIN(snapshot_date) as first_snapshot
      FROM repo_metrics_history
      GROUP BY full_name
    )
    SELECT
      COALESCE(f.full_name, t.full_name) as full_name,
      COALESCE(t.loc, 0) - COALESCE(f.loc, 0) as loc_delta,
      COALESCE(t.file_count, 0) - COALESCE(f.file_count, 0) as file_count_delta,
      COALESCE(t.repo_size_kb, 0) - COALESCE(f.repo_size_kb, 0) as repo_size_kb_delta,
      COALESCE(t.stars, 0) - COALESCE(f.stars, 0) as stars_delta,
      COALESCE(t.forks, 0) - COALESCE(f.forks, 0) as forks_delta,
      COALESCE(t.open_issues, 0) - COALESCE(f.open_issues, 0) as open_issues_delta,
      COALESCE(t.loc, 0) as current_loc,
      COALESCE(t.file_count, 0) as current_file_count,
      COALESCE(t.stars, 0) as current_stars,
      COALESCE(f.loc, 0) as from_loc,
      (f.full_name IS NULL AND fs.first_snapshot > $1) as is_new,
      t.full_name IS NULL as is_removed
    FROM to_snapshot t
    FULL OUTER JOIN from_snapshot f USING (full_name)
    LEFT JOIN first_seen fs ON fs.full_name = COALESCE(f.full_name, t.full_name)
    ORDER BY ABS(COALESCE(t.loc, 0) - COALESCE(f.loc, 0)) DESC, COALESCE(f.full_name, t.full_name)
  `, [from, to]);
}

// ── Writes ─────────────────────────────────────────

export async function upsertSnapshot(db: SqlClient, input: SnapshotInput): Promise<void> {
  await db.query(upsertSnapshotSql(db.dialect.today), snapshotParams(input));
}
