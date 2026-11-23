/**
 * Logical schema shared by every storage adapter: collection names, their
 * columns and the default value of each column.
 *
 * SQL adapters get the same information from their DDL; adapters without a
 * database (memory, JSON, CSV) use these defaults to build complete records,
 * so a record has the same keys whichever adapter produced it.
 */
type Defaults = Record<string, unknown>;

/** Marker for columns filled with the current timestamp on insert. */
export const NOW = Symbol('now');

export const REPO_DEFAULTS: Defaults = {
  id: null,
  full_name: null,
  owner: null,
  name: null,
  description: null,
  is_private: false,
  is_archived: false,
  language: null,
  default_branch: 'main',
  stars: 0,
  forks: 0,
  watchers: 0,
  open_issues: 0,
  open_prs: 0,
  last_commit_at: null,
  repo_created_at: null,
  repo_updated_at: null,
  priority: null,
  next_action: null,
  blockers: [],
  has_readme: null,
  has_ci: null,
  has_tests: null,
  has_gitignore: null,
  has_roadmap: null,
  test_coverage: null,
  readme_lines: null,
  stack: null,
  has_unit_tests: null,
  has_integration_tests: null,
  has_e2e_tests: null,
  has_lint_config: null,
  has_type_checking: null,
  has_security_scan: null,
  has_perf_tests: null,
  test_framework: null,
  e2e_framework: null,
  lint_tool: null,
  docs_quality: null,
  has_docstrings: null,
  client: null,
  notes: null,
  production_urls: {},
  readme_content: null,
  summary: null,
  local_status: null,
  last_health_check: null,
  last_docs_check: null,
  github_cached_at: null,
  created_at: NOW,
  updated_at: NOW,
  ci_status: null,
  infra_provider: null,
  production_url: null,
  gcp_project: null,
  gcp_service: null,
  gcp_region: null,
  cloudflare_project: null,
  complexity_score: null,
  duplication_pct: null,
  security_issues_count: 0,
  critical_issues_count: 0,
  last_deep_analysis: null,
  deep_analysis_status: null,
  is_deleted: false,
  deleted_at: null,
  deletion_detected_at: null,
  coverage_updated_at: null,
  coverage_source: null,
  docs_file_count: 0,
  repo_size_kb: null,
  file_count: null,
  loc: null,
  topics: [],
  license_key: null,
  license_name: null,
  homepage: null,
  is_fork: false,
  parent_repo: null,
  has_issues: null,
  has_projects: null,
  has_wiki: null,
  has_pages: null,
  has_discussions: null,
  subscribers_count: 0,
  is_template: false,
  ci_status_url: null,
  ci_status_run_at: null,
  ci_status_checked_at: null,
  summary_generated_at: null,
  summary_model: null,
  summary_tokens_in: null,
  summary_tokens_out: null,
};

export const GROUP_DEFAULTS: Defaults = {
  id: null,
  slug: null,
  name: null,
  description: null,
  color: '#6366f1',
  created_at: NOW,
  updated_at: NOW,
};

export const REPO_GROUP_DEFAULTS: Defaults = {
  repo_id: null,
  group_id: null,
  added_at: NOW,
};

export const SERVICE_DEFAULTS: Defaults = {
  id: null,
  name: null,
  slug: null,
  url: null,
  provider: null,
  project: null,
  region: null,
  env: 'production',
  source_repo_full_name: null,
  source_path: null,
  last_check_at: null,
  last_check_status: 'unknown',
  last_check_response_ms: null,
  last_check_http_code: null,
  description: null,
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
};

export const REPO_APP_DEFAULTS: Defaults = {
  id: null,
  repo_full_name: null,
  app_path: null,
  app_name: null,
  slug: null,
  stack: null,
  has_ci: null,
  has_tests: null,
  has_readme: null,
  readme_lines: null,
  loc: null,
  file_count: null,
  docs_quality: null,
  detection_source: 'manual',
  last_health_check: null,
  created_at: NOW,
  updated_at: NOW,
  has_unit_tests: null,
  has_integration_tests: null,
  has_e2e_tests: null,
  has_lint_config: null,
  has_type_checking: null,
  has_security_scan: null,
  has_perf_tests: null,
  test_framework: null,
  e2e_framework: null,
  lint_tool: null,
};

export const METRICS_DEFAULTS: Defaults = {
  id: null,
  repo_id: null,
  full_name: null,
  snapshot_date: null,
  repo_size_kb: null,
  file_count: null,
  loc: null,
  stars: 0,
  forks: 0,
  watchers: 0,
  subscribers_count: 0,
  open_issues: 0,
  has_ci: null,
  has_tests: null,
  has_readme: null,
  readme_lines: null,
  has_gitignore: null,
  has_roadmap: null,
  docs_file_count: null,
  docs_quality: null,
  language: null,
  is_private: null,
  is_archived: null,
  is_fork: null,
  is_template: null,
  default_branch: null,
  created_at: NOW,
};

export const COVERAGE_DEFAULTS: Defaults = {
  id: null,
  repo_full_name: null,
  label: 'default',
  coverage: null,
  commit_sha: null,
  reported_at: NOW,
};

export const ACTIVITY_DEFAULTS: Defaults = {
  id: null,
  action: null,
  entity_type: null,
  entity_id: null,
  field_changed: null,
  old_value: null,
  new_value: null,
  actor_type: null,
  actor_name: null,
  metadata: {},
  created_at: NOW,
};

/** Views and clones of a repo on one UTC day (GitHub only keeps the last 14). */
export const TRAFFIC_DAILY_DEFAULTS: Defaults = {
  id: null,
  full_name: null,
  day: null,
  views: 0,
  views_unique: 0,
  clones: 0,
  clones_unique: 0,
  fetched_at: NOW,
};

/** Top referrers / popular paths as GitHub reported them on a given day (14-day rolling totals). */
export const TRAFFIC_SOURCE_DEFAULTS: Defaults = {
  id: null,
  full_name: null,
  day: null,
  kind: null,
  label: null,
  title: null,
  hits: 0,
  uniques: 0,
};

/** A named combination of dashboard tab + filters (`query` is the dashboard query string, without "?"). */
export const SAVED_VIEW_DEFAULTS: Defaults = {
  id: null,
  name: null,
  query: '',
  created_at: NOW,
  updated_at: NOW,
};

/** A signal fetched from GitHub for one repo (standards, security, ...): one record per repo and kind. */
export const REPO_SIGNAL_DEFAULTS: Defaults = {
  id: null,
  full_name: null,
  kind: null,
  data: {},
  checked_at: NOW,
};

/** One health check of a service, manual or scheduled (uptime history). */
export const SERVICE_CHECK_DEFAULTS: Defaults = {
  id: null,
  service_slug: null,
  status: null,
  response_ms: null,
  http_code: null,
  checked_at: NOW,
};

/**
 * A condition that needs attention (CI failing, service down, ...). One record per
 * occurrence: when the condition goes away the record is resolved, and a new one is
 * opened if it comes back.
 */
export const ALERT_DEFAULTS: Defaults = {
  id: null,
  key: null,
  kind: null,
  entity: null,
  title: null,
  detail: {},
  url: null,
  level: 0,
  status: 'open',
  opened_at: NOW,
  resolved_at: null,
};

/** Where alerts are sent (a webhook, a chat). `config` holds the destination and is a secret. */
export const ALERT_CHANNEL_DEFAULTS: Defaults = {
  id: null,
  name: null,
  type: null,
  config: {},
  kinds: [],
  is_enabled: true,
  digest: 'off',
  last_sent_at: null,
  last_error: null,
  last_digest_at: null,
  created_at: NOW,
  updated_at: NOW,
};

export const COLLECTIONS = {
  repos: REPO_DEFAULTS,
  groups: GROUP_DEFAULTS,
  repo_groups: REPO_GROUP_DEFAULTS,
  services: SERVICE_DEFAULTS,
  repo_apps: REPO_APP_DEFAULTS,
  repo_metrics_history: METRICS_DEFAULTS,
  coverage_reports: COVERAGE_DEFAULTS,
  activity_log: ACTIVITY_DEFAULTS,
  repo_traffic_daily: TRAFFIC_DAILY_DEFAULTS,
  repo_traffic_sources: TRAFFIC_SOURCE_DEFAULTS,
  saved_views: SAVED_VIEW_DEFAULTS,
  repo_signals: REPO_SIGNAL_DEFAULTS,
  service_checks: SERVICE_CHECK_DEFAULTS,
  alerts: ALERT_DEFAULTS,
  alert_channels: ALERT_CHANNEL_DEFAULTS,
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

const REPO_COLUMNS = new Set(Object.keys(REPO_DEFAULTS));

/** True when `name` is a real column of `repos` (guards dynamic field updates). */
export function isRepoColumn(name: string): boolean {
  return REPO_COLUMNS.has(name);
}

// ── Allowed values (CHECK constraints in SQL) ───────

export const ALLOWED_VALUES: Record<string, readonly string[]> = {
  priority: ['high', 'medium', 'low', 'paused'],
  local_status: ['reviewed', 'pending', 'archived'],
  docs_quality: ['excellent', 'good', 'needs_work', 'missing'],
};

// ── Column types ────────────────────────────────────
// Needed by stores that keep values as text (CSV) to read them back faithfully.

export type ColumnType = 'text' | 'int' | 'bool' | 'json' | 'timestamp' | 'date';

/** Integer columns whose default is null, so the default alone does not reveal the type. */
const NULLABLE_INT_COLUMNS = new Set([
  'id', 'repo_id', 'group_id', 'test_coverage', 'readme_lines', 'complexity_score', 'duplication_pct',
  'repo_size_kb', 'file_count', 'loc', 'summary_tokens_in', 'summary_tokens_out', 'coverage',
  'last_check_response_ms', 'last_check_http_code', 'docs_file_count', 'response_ms', 'http_code',
]);
const TIMESTAMP_COLUMN = /_at$|^last_health_check$|^last_docs_check$|^last_deep_analysis$/;

export function columnType(collection: CollectionName, column: string): ColumnType {
  const fallback = (COLLECTIONS[collection] as Defaults)[column];
  if (column === 'snapshot_date' || column === 'day') return 'date';
  if (column === 'summary' || (typeof fallback === 'object' && fallback !== null)) return 'json';
  if (fallback === NOW || TIMESTAMP_COLUMN.test(column)) return 'timestamp';
  if (typeof fallback === 'boolean' || /^(is|has)_/.test(column)) return 'bool';
  if (typeof fallback === 'number' || NULLABLE_INT_COLUMNS.has(column)) return 'int';
  return 'text';
}

export function columnsOf(collection: CollectionName): string[] {
  return Object.keys(COLLECTIONS[collection]);
}
