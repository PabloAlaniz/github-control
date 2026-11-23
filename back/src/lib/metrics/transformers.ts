/** DRY micro-functions to transform DB rows into API response shapes. */

import type { CodeMetrics, GithubMetrics, HealthMetrics, RepoSnapshot } from './types';

export const toCodeMetrics = (row: any): CodeMetrics => ({
  sizeKb: row.repo_size_kb ?? 0,
  fileCount: row.file_count ?? 0,
  loc: row.loc ?? 0,
});

export const toGithubMetrics = (row: any): GithubMetrics => ({
  stars: row.stars ?? 0,
  forks: row.forks ?? 0,
  watchers: row.watchers ?? 0,
  subscribers: row.subscribers_count ?? 0,
  openIssues: row.open_issues ?? 0,
});

export const toHealthMetrics = (row: any): HealthMetrics => ({
  hasCi: row.has_ci ?? false,
  hasTests: row.has_tests ?? false,
  hasReadme: row.has_readme ?? false,
  readmeLines: row.readme_lines ?? 0,
  docsQuality: row.docs_quality ?? 'missing',
  docsFileCount: row.docs_file_count ?? 0,
});

export const toRepoSnapshot = (row: any): RepoSnapshot => ({
  date: row.snapshot_date,
  code: toCodeMetrics(row),
  github: toGithubMetrics(row),
  health: toHealthMetrics(row),
});
