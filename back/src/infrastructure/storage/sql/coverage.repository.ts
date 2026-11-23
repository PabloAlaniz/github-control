import type { SqlClient } from './client';

export async function upsertCoverage(db: SqlClient, fullName: string, label: string, coverage: number, commitSha?: string): Promise<void> {
  await db.query(`
    INSERT INTO coverage_reports (repo_full_name, label, coverage, commit_sha)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (repo_full_name, label) DO UPDATE SET
      coverage = $3, commit_sha = $4, reported_at = ${db.dialect.now}
  `, [fullName, label, coverage, commitSha]);
}

export async function updateRepoCoverage(db: SqlClient, fullName: string, coverage: number): Promise<void> {
  await db.query(`
    UPDATE repos SET
      test_coverage = $1, has_tests = true,
      coverage_updated_at = ${db.dialect.now}, coverage_source = 'ci',
      last_health_check = ${db.dialect.now}
    WHERE full_name = $2
  `, [coverage, fullName]);
}

export async function listCoverageReports(db: SqlClient, fullName: string) {
  return db.query(`
    SELECT label, coverage, commit_sha, reported_at
    FROM coverage_reports WHERE repo_full_name = $1
    ORDER BY label
  `, [fullName]);
}
