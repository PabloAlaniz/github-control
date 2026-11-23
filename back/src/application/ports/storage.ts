/**
 * Storage ports.
 *
 * Everything the application needs from persistence, expressed without any
 * reference to SQL, a driver or a runtime. Routes and services depend on
 * these interfaces only; adapters under `infrastructure/storage/*` implement
 * them (Postgres today; SQLite, JSON and CSV next).
 *
 * Shapes: rows use the snake_case column names the HTTP API exposes. Counts
 * and sums are numbers, calendar dates are 'YYYY-MM-DD' strings and
 * timestamps serialize to ISO-8601. `tests/contract` runs the same suite
 * against every adapter to hold them to this definition.
 */
import type { ActivityParams } from '../../types';
import type { SnapshotInput } from '../../lib/metrics/types';

/** A persisted record as exposed by the API (snake_case keys). */
export type Row = Record<string, any>;

// ── Repos ───────────────────────────────────────────

export interface RepoVisibilityOptions {
  includeDeleted?: boolean;
  includeArchived?: boolean;
  includePaused?: boolean;
}

/** Query-string style filters: 'true' | 'false' | 'all' | undefined. */
export interface RepoFilters {
  stack?: string;
  priority?: string;
  has_ci?: string;
  has_tests?: string;
  has_readme?: string;
  has_roadmap?: string;
  archived?: string;
  deleted?: string;
  paused?: string;
}

export interface RepoStats {
  /** Active repos (not deleted, archived or paused). */
  total: number;
  with_ci: number;
  with_tests: number;
  archived: number;
  deleted: number;
  paused: number;
}

export interface RepoStore {
  /** Repos with their group slugs in `groups`, newest activity first. */
  listRepos(options?: RepoVisibilityOptions): Promise<Row[]>;
  getRepo(fullName: string): Promise<Row | null>;
  getLanguage(fullName: string): Promise<{ id: number; language: string | null } | null>;
  filterRepos(filters: RepoFilters): Promise<Row[]>;
  listAllCoverage(): Promise<{ repo_full_name: string; label: string; coverage: number }[]>;
  listAllAppsEnriched(): Promise<Row[]>;

  deleteRepo(fullName: string): Promise<void>;
  updateArchived(fullName: string): Promise<void>;
  updateStatus(fullName: string, status: string): Promise<void>;
  updatePriority(fullName: string, priority: string): Promise<void>;
  addBlocker(fullName: string, blocker: string): Promise<void>;
  removeBlocker(fullName: string, blocker: string): Promise<void>;

  listDeleted(): Promise<Row[]>;
  /** Hard-deletes soft-deleted repos (one or all). Returns what was purged. */
  purgeDeleted(fullName?: string): Promise<{ full_name: string }[]>;

  getRepoForValidation(
    fullName: string,
  ): Promise<{ priority: string | null; is_archived: boolean; is_deleted: boolean } | null>;
  listAllowed(): Promise<{ full_name: string }[]>;

  getStats(): Promise<RepoStats>;
  getCacheStatus(): Promise<{ count: number; latest: string | null }>;

  /**
   * Upserts the repos fetched from GitHub, soft-deletes the ones no longer
   * present and restores the ones that came back. Must be atomic.
   * Rejects an empty list (it would soft-delete everything).
   */
  refreshFromGitHub(repos: Row[]): Promise<{ removedRepos: string[]; restoredRepos: string[] }>;
}

// ── Groups ──────────────────────────────────────────

export interface GroupStore {
  /** Groups with `repo_count` (active repos only). */
  listGroups(): Promise<Row[]>;
  createGroup(slug: string, name: string, description?: string, color?: string): Promise<{ id: number } | null>;
  updateGroup(id: number, slug: string, name: string, description?: string, color?: string): Promise<void>;
  deleteGroup(id: number): Promise<void>;
  upsertGroupBySlug(
    slug: string, name: string, description?: string | null, color?: string | null,
  ): Promise<{ id: number } | null>;

  getRepoId(fullName: string): Promise<{ id: number } | null>;
  addRepoToGroup(repoId: number, groupId: number): Promise<void>;
  removeRepoFromGroup(repoId: number, groupId: number): Promise<void>;
  listAllRepoGroupEdges(): Promise<{ repo_full_name: string; group_slug: string }[]>;
}

// ── Repo meta (user-owned fields on a repo) ─────────

export interface MetaStore {
  /** Active repos counted per priority and per stack. */
  getMetaSummary(): Promise<{
    priorities: { priority: string; count: number }[];
    stacks: { stack: string; count: number }[];
  }>;
  getRepoMeta(fullName: string): Promise<Row | null>;
  /** Returns false when `updates` contains no patchable field. */
  patchRepoMeta(fullName: string, updates: Record<string, any>): Promise<boolean>;
  /** Sets arbitrary repo fields. Rejects keys that are not repo fields. */
  bulkUpdateMeta(updates: { full_name: string; [key: string]: any }[]): Promise<void>;
}

// ── Repo health, README and summaries ───────────────

export interface RepoHealthInput {
  hasCi: boolean; hasTests: boolean; hasReadme: boolean; hasGitignore: boolean;
  readmeLines: number; hasRoadmap: boolean; docsFileCount: number;
  hasUnitTests: boolean; hasIntegrationTests: boolean; hasE2eTests: boolean;
  hasLintConfig: boolean; hasTypeChecking: boolean; hasSecurityScan: boolean; hasPerfTests: boolean;
  testFramework: string | null; e2eFramework: string | null; lintTool: string | null;
}

export interface RepoDetailsInput {
  size?: number; default_branch: string; topics?: string[];
  license?: { key: string; name: string } | null;
  homepage?: string | null; fork?: boolean;
  parent?: { full_name: string } | null;
  has_issues?: boolean; has_projects?: boolean;
  has_wiki?: boolean; has_pages?: boolean;
  has_discussions?: boolean; subscribers_count?: number;
  is_template?: boolean;
}

export interface CiStatusInput {
  ci_status: string | null;
  ci_status_url: string | null;
  ci_status_run_at: string | null;
}

export interface AiSummaryRecord {
  generated_at: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  [key: string]: unknown;
}

export interface HealthStore {
  updateRepoHealth(
    fullName: string,
    health: RepoHealthInput,
    stack: string | null,
    docsQuality: string,
    repoDetails: RepoDetailsInput,
    loc?: number | null,
    fileCount?: number | null,
  ): Promise<void>;
  updateCiStatus(fullName: string, data: CiStatusInput): Promise<void>;
  updateManualHealth(fullName: string, health: Record<string, any>): Promise<void>;

  getReadmeContent(fullName: string): Promise<{ readme_content: string } | null>;
  cacheReadme(fullName: string, content: string, lines: number): Promise<void>;
  getDocs(fullName: string): Promise<{ readme_content: string; summary: any } | null>;
  getSummary(fullName: string): Promise<{ summary: any } | null>;
  saveSummary(fullName: string, summary: unknown): Promise<void>;
  /** Stores an AI-generated summary together with its generation metadata. */
  saveAiSummary(fullName: string, summary: AiSummaryRecord): Promise<void>;
}

// ── Monorepo apps ───────────────────────────────────

export interface AppUpsertInput {
  repo_full_name: string; app_path: string; app_name: string;
  slug: string; stack: string | null; detection_source: string;
}

export interface AppHealthInput {
  hasCi: boolean; hasTests: boolean; hasReadme: boolean; readmeLines: number;
  loc: number; fileCount: number; stack: string | null; docsQuality: string;
}

export interface AppTestingInput {
  hasUnitTests: boolean; hasIntegrationTests: boolean; hasE2eTests: boolean;
  hasLintConfig: boolean; hasTypeChecking: boolean; hasSecurityScan: boolean; hasPerfTests: boolean;
  testFramework: string | null; e2eFramework: string | null; lintTool: string | null;
}

export interface AppStore {
  listApps(repoFilter?: string): Promise<Row[]>;
  getApp(slug: string): Promise<Row | null>;
  getAppBasic(
    slug: string,
  ): Promise<{ id: number; repo_full_name: string; app_path: string; app_name: string } | null>;
  listAppsByRepo(
    repoFullName: string,
  ): Promise<{ id: number; slug: string; app_path: string; app_name: string }[]>;
  getAppForDelete(slug: string): Promise<{ id: number; app_name: string } | null>;

  upsertApp(data: AppUpsertInput): Promise<{ id: number; slug: string } | null>;
  updateApp(slug: string, fields: Record<string, any>): Promise<void>;
  deleteApp(slug: string): Promise<void>;
  /** Removes the apps of a repo whose slug is not in `currentSlugs`. No-op when the list is empty. */
  deleteStaleApps(repoFullName: string, currentSlugs: string[]): Promise<void>;
  updateAppHealth(slug: string, health: AppHealthInput, testing?: AppTestingInput): Promise<void>;
}

// ── Coverage ────────────────────────────────────────

export interface CoverageStore {
  upsertCoverage(fullName: string, label: string, coverage: number, commitSha?: string): Promise<void>;
  /** Mirrors the latest CI-reported coverage onto the repo itself. */
  updateRepoCoverage(fullName: string, coverage: number): Promise<void>;
  listCoverageReports(fullName: string): Promise<Row[]>;
}

// ── Metrics history ─────────────────────────────────

export interface TrendRow {
  full_name: string;
  loc_delta: number | null;
  stars_delta: number | null;
  open_issues_delta: number | null;
  current_loc: number | null;
  prev_loc: number | null;
  period_days: number;
}

export interface MetricsStore {
  getRepoMetrics(fullName: string, days: number): Promise<Row[]>;
  getSnapshot(date: string): Promise<Row[]>;
  getAggregate(days: number): Promise<Row[]>;
  /** Latest snapshot per repo minus the most recent one taken on/before (today - days). */
  getBulkTrends(days: number): Promise<TrendRow[]>;
  /** 'YYYY-MM-DD' of the most recent snapshot, or null when there is no history. */
  getLatestSnapshotDate(): Promise<string | null>;
  compareSnapshots(from: string, to: string): Promise<Row[]>;
  upsertSnapshot(input: SnapshotInput): Promise<void>;
}

// ── Services ────────────────────────────────────────

export interface ServiceFilters {
  provider?: string;
  env?: string;
  sourceRepo?: string;
  isActive?: string;
}

export interface ServiceCreateInput {
  name: string; slug: string; url?: string; provider: string;
  project?: string; region?: string; env?: string;
  source_repo_full_name?: string; source_path?: string; description?: string;
}

export interface ServiceStore {
  listServices(filters: ServiceFilters): Promise<Row[]>;
  getService(slug: string): Promise<Row | null>;
  getServiceBasic(slug: string): Promise<{ id: number; url: string; name: string } | null>;
  getServiceForDelete(slug: string): Promise<Row | null>;
  listActiveServices(): Promise<{ slug: string; url: string; name: string }[]>;
  listServicesByRepo(fullName: string): Promise<Row[]>;

  createService(data: ServiceCreateInput): Promise<{ id: number; slug: string } | null>;
  updateService(slug: string, fields: Record<string, any>): Promise<void>;
  deleteService(slug: string): Promise<void>;
  updateHealthCheck(
    slug: string, status: string, responseMs: number | null, httpCode: number | null,
  ): Promise<void>;
  /** Fills missing service URLs and creates services from repos that declare a homepage. */
  syncFromRepos(): Promise<{ updatedCount: number; createdCount: number }>;
}

// ── Activity log ────────────────────────────────────

export interface ActivityFilters {
  entityType?: string;
  entityId?: string;
  actorType?: string;
  actorName?: string;
  action?: string;
  limit: number;
  offset: number;
}

export interface ActivityStore {
  /** Appends an entry and returns it formatted for the API. */
  logActivity(params: ActivityParams): Promise<Row | null>;
  listActivities(filters: ActivityFilters): Promise<Row[]>;
  getStatsByActor(): Promise<Row[]>;
  getStatsByDay(days: number): Promise<Row[]>;
  getActivityCount(entityType?: string, entityId?: string): Promise<number>;
  getActivitiesByEntity(entityType: string, entityId: string, limit: number): Promise<Row[]>;
}

// ── Traffic history ─────────────────────────────────

export interface TrafficDay {
  /** UTC day, 'YYYY-MM-DD'. */
  day: string;
  views: number;
  views_unique: number;
  clones: number;
  clones_unique: number;
}

export type TrafficSourceKind = 'referrer' | 'path';

export interface TrafficSource {
  /** The referrer (e.g. "google.com") or the path (e.g. "/acme/api/issues"). */
  label: string;
  /** Page title, for paths. */
  title?: string | null;
  hits: number;
  uniques: number;
}

export interface TrafficStore {
  /** Stores per-day counts; a day already stored is overwritten with the newer numbers. */
  upsertDaily(fullName: string, days: TrafficDay[]): Promise<void>;
  /** Replaces the referrers or paths recorded for `fullName` on `day`. */
  replaceSources(fullName: string, day: string, kind: TrafficSourceKind, sources: TrafficSource[]): Promise<void>;
  /** Per-day counts of one repo over the last `days` days, oldest first. */
  getDaily(fullName: string, days: number): Promise<TrafficDay[]>;
  /** Per-day counts summed over all repos, oldest first. */
  getDailyTotals(days: number): Promise<TrafficDay[]>;
  /** Totals per repo over the last `days` days, most viewed first. */
  getTotalsByRepo(days: number): Promise<(Omit<TrafficDay, 'day'> & { full_name: string })[]>;
  /** The most recently recorded referrers or paths of a repo, busiest first. */
  getSources(fullName: string, kind: TrafficSourceKind): Promise<{ day: string | null; sources: TrafficSource[] }>;
}

// ── Whole-storage operations ────────────────────────

/** Every record of every collection, keyed by collection name, as plain JSON values. */
// ── Saved views ─────────────────────────────────────

export interface SavedView {
  id: number;
  name: string;
  /** Dashboard query string (tab + filters), without the leading "?". */
  query: string;
  created_at: string;
  updated_at: string;
}

export interface SavedViewStore {
  /** Ordered by name, ignoring case. */
  listSavedViews(): Promise<SavedView[]>;
  /** Creates the view, or replaces the query of the one with the same name. */
  upsertSavedView(name: string, query: string): Promise<SavedView>;
  /** False when no view has that id. */
  deleteSavedView(id: number): Promise<boolean>;
}

// ── Repo signals ────────────────────────────────────

/** Data fetched from GitHub for a repo and cached: one record per repo and kind. */
export interface SignalRecord {
  full_name: string;
  kind: string;
  data: Record<string, any>;
  checked_at: string;
}

export interface SignalStore {
  /** Stores (or replaces) a signal. Null when the repo is not in the store. */
  upsertSignal(fullName: string, kind: string, data: Record<string, unknown>): Promise<SignalRecord | null>;
  getRepoSignals(fullName: string): Promise<SignalRecord[]>;
  /** Every stored signal, optionally of one kind, ordered by repo and kind. */
  listSignals(kind?: string): Promise<SignalRecord[]>;
}

// ── Service check history ───────────────────────────

export interface UptimeDayRow {
  slug: string;
  day: string;
  checks: number;
  down: number;
  degraded: number;
  /** Mean response time of the day's checks, rounded; null when none reported one. */
  avg_ms: number | null;
}

export interface IncidentRow {
  slug: string;
  /** Times the service went from not-down to down within the window. */
  incidents: number;
  last_down_at: string | null;
}

export interface ServiceCheckStore {
  /** Appends a check to the history. `checkedAt` defaults to now. */
  recordCheck(
    slug: string, status: string, responseMs: number | null, httpCode: number | null, checkedAt?: string,
  ): Promise<void>;
  /** Deletes checks older than `keepDays` days. */
  pruneChecks(keepDays: number): Promise<void>;
  /** Checks per service and UTC day over the last `days` days, ordered by service and day. */
  getDailyUptime(days: number): Promise<UptimeDayRow[]>;
  /** Only services that were down at least once in the window. */
  getIncidents(days: number): Promise<IncidentRow[]>;
}

// ── Alerts ──────────────────────────────────────────

export type AlertStatus = 'open' | 'resolved';

/** One occurrence of a condition that needs attention. */
export interface Alert {
  id: number;
  /** Identifies the condition, e.g. `ci_failing:acme/api`. At most one open alert per key. */
  key: string;
  kind: string;
  /** The repo (`owner/name`) or service slug it is about. */
  entity: string;
  title: string;
  detail: Record<string, any>;
  url: string | null;
  /** How bad it is, for conditions that can get worse while open (0 otherwise). */
  level: number;
  status: AlertStatus;
  opened_at: string;
  resolved_at: string | null;
}

export interface AlertInput {
  key: string;
  kind: string;
  entity: string;
  title: string;
  detail: Record<string, unknown>;
  url: string | null;
  level: number;
}

export interface AlertStore {
  /** Most recently opened first. */
  listAlerts(options?: { status?: AlertStatus; limit?: number }): Promise<Alert[]>;
  openAlert(input: AlertInput): Promise<Alert>;
  /** Refreshes what an open alert says. */
  updateAlert(id: number, fields: Pick<AlertInput, 'title' | 'detail' | 'url' | 'level'>): Promise<void>;
  resolveAlert(id: number): Promise<void>;
  /** Deletes alerts resolved more than `keepDays` days ago. */
  pruneResolved(keepDays: number): Promise<void>;
}

export type AlertDigest = 'off' | 'daily' | 'weekly';

/** A destination for alerts. */
export interface AlertChannel {
  id: number;
  name: string;
  type: string;
  /** Destination (URL, token, chat). Secret: never returned by the API as is. */
  config: Record<string, string>;
  /** Alert kinds it receives; empty means all. */
  kinds: string[];
  is_enabled: boolean;
  digest: AlertDigest;
  last_sent_at: string | null;
  /** Why the last delivery failed; null when it worked. */
  last_error: string | null;
  last_digest_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlertChannelInput {
  name: string;
  type: string;
  config: Record<string, string>;
  kinds: string[];
  is_enabled: boolean;
  digest: AlertDigest;
}

export interface AlertChannelStore {
  /** Oldest first. */
  listChannels(): Promise<AlertChannel[]>;
  getChannel(id: number): Promise<AlertChannel | null>;
  createChannel(input: AlertChannelInput): Promise<AlertChannel>;
  /** Null when no channel has that id. */
  updateChannel(id: number, input: AlertChannelInput): Promise<AlertChannel | null>;
  deleteChannel(id: number): Promise<boolean>;
  /** Records the outcome of a delivery; `digest` also marks the digest as sent. */
  recordDelivery(id: number, outcome: { error: string | null; digest?: boolean }): Promise<void>;
}

export type StorageDump = Record<string, Row[]>;

export interface AdminStore {
  /** A complete, adapter-independent copy of the data. */
  exportAll(): Promise<StorageDump>;
  /** Replaces all data with `dump` (ids included). Must be atomic. */
  importAll(dump: StorageDump): Promise<void>;
}

// ── Aggregate ───────────────────────────────────────

export interface Storage {
  repos: RepoStore;
  groups: GroupStore;
  meta: MetaStore;
  health: HealthStore;
  apps: AppStore;
  coverage: CoverageStore;
  metrics: MetricsStore;
  services: ServiceStore;
  activity: ActivityStore;
  traffic: TrafficStore;
  savedViews: SavedViewStore;
  signals: SignalStore;
  serviceChecks: ServiceCheckStore;
  alerts: AlertStore;
  alertChannels: AlertChannelStore;
  admin: AdminStore;
}
