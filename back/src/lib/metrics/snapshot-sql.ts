/**
 * Shared SQL builder for snapshot upsert.
 * Used by both Cloudflare Workers (metrics.repository.ts) and
 * local scripts (unified-sync.ts) which use different DB drivers.
 */

import type { SnapshotInput } from './types';

/** `today` is the SQL expression for the current date in the target engine. */
export const upsertSnapshotSql = (today = 'CURRENT_DATE') => `
  INSERT INTO repo_metrics_history (
    repo_id, full_name, snapshot_date,
    repo_size_kb, file_count, loc,
    stars, forks, watchers, subscribers_count, open_issues,
    has_ci, has_tests, has_readme, readme_lines, has_gitignore, has_roadmap,
    docs_file_count, docs_quality,
    language, is_private, is_archived, is_fork, is_template, default_branch
  ) VALUES (
    $1, $2, ${today},
    $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16,
    $17, $18,
    $19, $20, $21, $22, $23, $24
  )
  ON CONFLICT (repo_id, snapshot_date) DO UPDATE SET
    repo_size_kb = EXCLUDED.repo_size_kb,
    file_count = EXCLUDED.file_count,
    loc = EXCLUDED.loc,
    stars = EXCLUDED.stars,
    forks = EXCLUDED.forks,
    watchers = EXCLUDED.watchers,
    subscribers_count = EXCLUDED.subscribers_count,
    open_issues = EXCLUDED.open_issues,
    has_ci = EXCLUDED.has_ci,
    has_tests = EXCLUDED.has_tests,
    has_readme = EXCLUDED.has_readme,
    readme_lines = EXCLUDED.readme_lines,
    has_gitignore = EXCLUDED.has_gitignore,
    has_roadmap = EXCLUDED.has_roadmap,
    docs_file_count = EXCLUDED.docs_file_count,
    docs_quality = EXCLUDED.docs_quality,
    language = EXCLUDED.language,
    is_private = EXCLUDED.is_private,
    is_archived = EXCLUDED.is_archived,
    is_fork = EXCLUDED.is_fork,
    is_template = EXCLUDED.is_template,
    default_branch = EXCLUDED.default_branch
`;

/** Postgres form, used by the standalone sync script. */
export const UPSERT_SNAPSHOT_SQL = upsertSnapshotSql();

/** Build the params array from a SnapshotInput. */
export function snapshotParams(input: SnapshotInput): unknown[] {
  return [
    input.repoId,
    input.fullName,
    input.code.sizeKb,
    input.code.fileCount,
    input.code.loc,
    input.github.stars,
    input.github.forks,
    input.github.watchers,
    input.github.subscribersCount,
    input.github.openIssues,
    input.health.hasCi,
    input.health.hasTests,
    input.health.hasReadme,
    input.health.readmeLines,
    input.health.hasGitignore,
    input.health.hasRoadmap,
    input.health.docsFileCount,
    input.health.docsQuality,
    input.meta.language,
    input.meta.isPrivate,
    input.meta.isArchived,
    input.meta.isFork,
    input.meta.isTemplate,
    input.meta.defaultBranch,
  ];
}
