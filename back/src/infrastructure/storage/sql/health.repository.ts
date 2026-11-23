import type { AiSummaryRecord } from '../../../application/ports/storage';
import { isoTimestamp, type SqlClient } from './client';

// ── Repo health ─────────────────────────────────────

export async function updateRepoHealth(
  db: SqlClient,
  fullName: string,
  health: {
    hasCi: boolean; hasTests: boolean; hasReadme: boolean; hasGitignore: boolean;
    readmeLines: number; hasRoadmap: boolean; docsFileCount: number;
    hasUnitTests: boolean; hasIntegrationTests: boolean; hasE2eTests: boolean;
    hasLintConfig: boolean; hasTypeChecking: boolean; hasSecurityScan: boolean; hasPerfTests: boolean;
    testFramework: string | null; e2eFramework: string | null; lintTool: string | null;
  },
  stack: string | null,
  docsQuality: string,
  repoDetails: {
    size?: number; default_branch: string; topics?: string[];
    license?: { key: string; name: string } | null;
    homepage?: string | null; fork?: boolean;
    parent?: { full_name: string } | null;
    has_issues?: boolean; has_projects?: boolean;
    has_wiki?: boolean; has_pages?: boolean;
    has_discussions?: boolean; subscribers_count?: number;
    is_template?: boolean;
  },
  loc?: number | null,
  fileCount?: number | null,
): Promise<void> {
  await db.query(`
    UPDATE repos SET
      has_ci = $1, has_tests = $2, has_readme = $3, has_gitignore = $4,
      readme_lines = $5, stack = $6, has_roadmap = $7, last_health_check = ${db.dialect.now},
      docs_quality = $8, docs_file_count = $9,
      repo_size_kb = $10, default_branch = $11,
      topics = $12, license_key = $13, license_name = $14, homepage = $15,
      is_fork = $16, parent_repo = $17,
      has_issues = $18, has_projects = $19, has_wiki = $20, has_pages = $21, has_discussions = $22,
      subscribers_count = $23, is_template = $24,
      has_unit_tests = $25, has_integration_tests = $26, has_e2e_tests = $27,
      has_lint_config = $28, has_type_checking = $29, has_security_scan = $30, has_perf_tests = $31,
      test_framework = $32, e2e_framework = $33, lint_tool = $34,
      loc = $35, file_count = $36,
      last_deep_analysis = ${db.dialect.now}, deep_analysis_status = 'completed',
      last_docs_check = ${db.dialect.now}
    WHERE full_name = $37
  `, [
    health.hasCi, health.hasTests, health.hasReadme, health.hasGitignore,
    health.readmeLines, stack, health.hasRoadmap, docsQuality, health.docsFileCount,
    repoDetails.size ?? null, repoDetails.default_branch,
    JSON.stringify(repoDetails.topics ?? []),
    repoDetails.license?.key ?? null, repoDetails.license?.name ?? null,
    repoDetails.homepage ?? null, repoDetails.fork ?? false,
    repoDetails.parent?.full_name ?? null,
    repoDetails.has_issues ?? null, repoDetails.has_projects ?? null,
    repoDetails.has_wiki ?? null, repoDetails.has_pages ?? null,
    repoDetails.has_discussions ?? null, repoDetails.subscribers_count ?? 0,
    repoDetails.is_template ?? false,
    health.hasUnitTests, health.hasIntegrationTests, health.hasE2eTests,
    health.hasLintConfig, health.hasTypeChecking, health.hasSecurityScan, health.hasPerfTests,
    health.testFramework, health.e2eFramework, health.lintTool,
    loc ?? null, fileCount ?? null,
    fullName
  ]);
}

export async function updateCiStatus(
  db: SqlClient,
  fullName: string,
  data: { ci_status: string | null; ci_status_url: string | null; ci_status_run_at: string | null },
): Promise<void> {
  await db.query(`
    UPDATE repos SET
      ci_status = $1,
      ci_status_url = $2,
      ci_status_run_at = $3,
      ci_status_checked_at = ${db.dialect.now}
    WHERE full_name = $4
  `, [data.ci_status, data.ci_status_url, isoTimestamp(data.ci_status_run_at), fullName]);
}

export async function updateManualHealth(db: SqlClient, fullName: string, health: Record<string, any>): Promise<void> {
  await db.query(`
    UPDATE repos SET
      has_ci = $1, has_tests = $2, has_readme = $3, has_gitignore = $4,
      test_coverage = $5, readme_lines = $6, stack = $7, has_roadmap = $8, last_health_check = ${db.dialect.now}
    WHERE full_name = $9
  `, [health.has_ci, health.has_tests, health.has_readme, health.has_gitignore,
    health.test_coverage, health.readme_lines, health.stack, health.has_roadmap, fullName]);
}

// ── README / Docs ───────────────────────────────────

export async function getReadmeContent(db: SqlClient, fullName: string) {
  return db.queryOne<{ readme_content: string }>(`
    SELECT readme_content FROM repos WHERE full_name = $1
  `, [fullName]);
}

export async function cacheReadme(db: SqlClient, fullName: string, content: string, lines: number): Promise<void> {
  await db.query(`
    UPDATE repos SET readme_content = $1, has_readme = $2, readme_lines = $3
    WHERE full_name = $4
  `, [content, lines > 0, lines, fullName]);
}

export async function getDocs(db: SqlClient, fullName: string) {
  return db.queryOne<{ readme_content: string; summary: any }>(`
    SELECT readme_content, summary FROM repos WHERE full_name = $1
  `, [fullName]);
}

export async function saveSummary(db: SqlClient, fullName: string, summary: any): Promise<void> {
  await db.query(`
    UPDATE repos SET summary = $1, last_docs_check = ${db.dialect.now}
    WHERE full_name = $2
  `, [JSON.stringify(summary), fullName]);
}

export async function getSummary(db: SqlClient, fullName: string) {
  return db.queryOne<{ summary: any }>(`SELECT summary FROM repos WHERE full_name = $1`, [fullName]);
}

export async function saveAiSummary(db: SqlClient, fullName: string, summary: AiSummaryRecord): Promise<void> {
  await db.query(`
    UPDATE repos SET
      summary = $1,
      summary_generated_at = $2,
      summary_model = $3,
      summary_tokens_in = $4,
      summary_tokens_out = $5,
      last_docs_check = ${db.dialect.now}
    WHERE full_name = $6
  `, [
    JSON.stringify(summary),
    isoTimestamp(summary.generated_at),
    summary.model,
    summary.tokens_in,
    summary.tokens_out,
    fullName,
  ]);
}
