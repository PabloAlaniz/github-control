import type { SqlClient } from './client';

// ── List / Get ──────────────────────────────────────

export async function listApps(db: SqlClient, repoFilter?: string) {
  let sql = `
    SELECT ra.*,
      cr.coverage as coverage_value,
      cr.commit_sha as coverage_commit_sha
    FROM repo_apps ra
    LEFT JOIN coverage_reports cr
      ON cr.repo_full_name = ra.repo_full_name AND cr.label = ra.app_name
  `;
  const params: unknown[] = [];

  if (repoFilter) {
    sql += ' WHERE ra.repo_full_name = $1';
    params.push(repoFilter);
  }

  sql += ' ORDER BY ra.repo_full_name, ra.app_name';
  return db.query(sql, params);
}

export async function getApp(db: SqlClient, slug: string) {
  return db.queryOne(`
    SELECT ra.*,
      cr.coverage as coverage_value,
      cr.commit_sha as coverage_commit_sha
    FROM repo_apps ra
    LEFT JOIN coverage_reports cr
      ON cr.repo_full_name = ra.repo_full_name AND cr.label = ra.app_name
    WHERE ra.slug = $1
  `, [slug]);
}

export async function getAppBasic(db: SqlClient, slug: string) {
  return db.queryOne<{
    id: number; repo_full_name: string; app_path: string; app_name: string;
  }>(`SELECT id, repo_full_name, app_path, app_name FROM repo_apps WHERE slug = $1`, [slug]);
}

export async function listAppsByRepo(db: SqlClient, repoFullName: string) {
  return db.query<{ id: number; slug: string; app_path: string; app_name: string }>(
    `SELECT id, slug, app_path, app_name FROM repo_apps WHERE repo_full_name = $1`, [repoFullName]
  );
}

// ── Mutations ───────────────────────────────────────

export async function upsertApp(db: SqlClient, data: {
  repo_full_name: string; app_path: string; app_name: string;
  slug: string; stack: string | null; detection_source: string;
}) {
  return db.queryOne<{ id: number; slug: string }>(`
    INSERT INTO repo_apps (repo_full_name, app_path, app_name, slug, stack, detection_source)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (slug) DO UPDATE SET
      app_name = EXCLUDED.app_name,
      app_path = EXCLUDED.app_path,
      stack = COALESCE(EXCLUDED.stack, repo_apps.stack),
      detection_source = EXCLUDED.detection_source
    RETURNING id, slug
  `, [data.repo_full_name, data.app_path, data.app_name, data.slug, data.stack, data.detection_source]);
}

export async function updateApp(db: SqlClient, slug: string, fields: Record<string, any>): Promise<void> {
  const { app_name, stack, has_ci, has_tests, has_readme, readme_lines, loc, file_count, docs_quality } = fields;
  await db.query(`
    UPDATE repo_apps SET
      app_name = COALESCE($1, app_name),
      stack = COALESCE($2, stack),
      has_ci = COALESCE($3, has_ci),
      has_tests = COALESCE($4, has_tests),
      has_readme = COALESCE($5, has_readme),
      readme_lines = COALESCE($6, readme_lines),
      loc = COALESCE($7, loc),
      file_count = COALESCE($8, file_count),
      docs_quality = COALESCE($9, docs_quality)
    WHERE slug = $10
  `, [app_name || null, stack || null, has_ci ?? null, has_tests ?? null, has_readme ?? null,
      readme_lines ?? null, loc ?? null, file_count ?? null, docs_quality || null, slug]);
}

export async function deleteApp(db: SqlClient, slug: string): Promise<void> {
  await db.query(`DELETE FROM repo_apps WHERE slug = $1`, [slug]);
}

export async function deleteStaleApps(db: SqlClient, repoFullName: string, currentSlugs: string[]): Promise<void> {
  if (currentSlugs.length === 0) return;
  const placeholders = currentSlugs.map((_, i) => `$${i + 2}`).join(', ');
  await db.query(
    `DELETE FROM repo_apps WHERE repo_full_name = $1 AND slug NOT IN (${placeholders}) RETURNING slug, app_name`,
    [repoFullName, ...currentSlugs],
  );
}

export async function getAppForDelete(db: SqlClient, slug: string) {
  return db.queryOne<{ id: number; app_name: string }>(`
    SELECT id, app_name FROM repo_apps WHERE slug = $1
  `, [slug]);
}

// ── App health update (single source of truth) ─────

export async function updateAppHealth(
  db: SqlClient,
  slug: string,
  health: {
    hasCi: boolean; hasTests: boolean; hasReadme: boolean; readmeLines: number;
    loc: number; fileCount: number; stack: string | null; docsQuality: string;
  },
  testing?: {
    hasUnitTests: boolean; hasIntegrationTests: boolean; hasE2eTests: boolean;
    hasLintConfig: boolean; hasTypeChecking: boolean; hasSecurityScan: boolean; hasPerfTests: boolean;
    testFramework: string | null; e2eFramework: string | null; lintTool: string | null;
  }
): Promise<void> {
  if (testing) {
    await db.query(`
      UPDATE repo_apps SET
        has_ci = $1, has_tests = $2, has_readme = $3, readme_lines = $4,
        loc = $5, file_count = $6, stack = COALESCE($7, stack),
        docs_quality = $8, last_health_check = ${db.dialect.now},
        has_unit_tests = $9, has_integration_tests = $10, has_e2e_tests = $11,
        has_lint_config = $12, has_type_checking = $13, has_security_scan = $14, has_perf_tests = $15,
        test_framework = $16, e2e_framework = $17, lint_tool = $18
      WHERE slug = $19
    `, [
      health.hasCi, health.hasTests, health.hasReadme, health.readmeLines,
      health.loc, health.fileCount, health.stack || null, health.docsQuality,
      testing.hasUnitTests, testing.hasIntegrationTests, testing.hasE2eTests,
      testing.hasLintConfig, testing.hasTypeChecking, testing.hasSecurityScan, testing.hasPerfTests,
      testing.testFramework, testing.e2eFramework, testing.lintTool,
      slug
    ]);
  }
  await db.query(`
    UPDATE repo_apps SET
      has_ci = $1, has_tests = $2, has_readme = $3, readme_lines = $4,
      loc = $5, file_count = $6, stack = COALESCE($7, stack),
      docs_quality = $8, last_health_check = ${db.dialect.now}
    WHERE slug = $9
  `, [health.hasCi, health.hasTests, health.hasReadme, health.readmeLines,
    health.loc, health.fileCount, health.stack || null, health.docsQuality, slug]);
}
