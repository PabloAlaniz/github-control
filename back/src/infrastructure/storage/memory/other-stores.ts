/** In-memory stores for apps, coverage, metrics history, services and activity. */
import type {
  ActivityStore, AppStore, CoverageStore, MetricsStore, Row, ServiceStore,
} from '../../../application/ports/storage';
import { formatLogRow } from '../../../domain/activity';
import { toMillis } from '../../../domain/repos';
import { hasHomepage, serviceFromRepo } from '../../../domain/services';
import { addDays, clone, compareText, uniqueViolation, type MemoryDb } from './db';

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const field of fields) out[field] = clone(row[field]);
  return out;
}

/** SQL COALESCE(new, current): keep the current value when the new one is null/undefined. */
function coalesce(values: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** Sum that ignores nulls and is null when there is nothing to add (SQL SUM). */
function sum(rows: Row[], field: string): number | null {
  const values = rows.map((r) => r[field]).filter((v) => v !== null && v !== undefined);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

function minus(a: number | null | undefined, b: number | null | undefined): number | null {
  return a === null || a === undefined || b === null || b === undefined ? null : a - b;
}

// ── Monorepo apps ───────────────────────────────────

export function createAppStore(db: MemoryDb): AppStore {
  const findApp = (slug: string) => db.table('repo_apps').find((a) => a.slug === slug);

  const withCoverage = (app: Row): Row => {
    const report = db.table('coverage_reports').find(
      (c) => c.repo_full_name === app.repo_full_name && c.label === app.app_name,
    );
    return {
      ...clone(app),
      coverage_value: report?.coverage ?? null,
      coverage_commit_sha: report?.commit_sha ?? null,
    };
  };

  return {
    async listApps(repoFilter) {
      return db.table('repo_apps')
        .filter((a) => !repoFilter || a.repo_full_name === repoFilter)
        .sort((a, b) => compareText(a.repo_full_name, b.repo_full_name) || compareText(a.app_name, b.app_name))
        .map(withCoverage);
    },

    async getApp(slug) {
      const app = findApp(slug);
      return app ? withCoverage(app) : null;
    },

    async getAppBasic(slug) {
      const app = findApp(slug);
      return app
        ? { id: app.id, repo_full_name: app.repo_full_name, app_path: app.app_path, app_name: app.app_name }
        : null;
    },

    async listAppsByRepo(repoFullName) {
      return db.table('repo_apps')
        .filter((a) => a.repo_full_name === repoFullName)
        .map((a) => ({ id: a.id, slug: a.slug, app_path: a.app_path, app_name: a.app_name }));
    },

    async getAppForDelete(slug) {
      const app = findApp(slug);
      return app ? { id: app.id, app_name: app.app_name } : null;
    },

    async upsertApp(data) {
      let app = findApp(data.slug);
      const samePath = db.table('repo_apps').find(
        (a) => a.repo_full_name === data.repo_full_name && a.app_path === data.app_path && a.slug !== data.slug,
      );
      if (samePath) throw uniqueViolation('repo_apps_repo_full_name_app_path_key');

      if (app) {
        db.update('repo_apps', app, {
          app_name: data.app_name, app_path: data.app_path,
          detection_source: data.detection_source,
          ...coalesce({ stack: data.stack }),
        });
      } else {
        app = db.insert('repo_apps', { ...data });
      }
      await db.commit();
      return { id: app.id, slug: app.slug };
    },

    async updateApp(slug, fields) {
      const app = findApp(slug);
      if (!app) return;
      db.update('repo_apps', app, coalesce({
        app_name: fields.app_name || null,
        stack: fields.stack || null,
        has_ci: fields.has_ci,
        has_tests: fields.has_tests,
        has_readme: fields.has_readme,
        readme_lines: fields.readme_lines,
        loc: fields.loc,
        file_count: fields.file_count,
        docs_quality: fields.docs_quality || null,
      }));
      await db.commit();
    },

    async deleteApp(slug) {
      db.remove('repo_apps', (a) => a.slug === slug);
      await db.commit();
    },

    async deleteStaleApps(repoFullName, currentSlugs) {
      if (currentSlugs.length === 0) return;
      db.remove('repo_apps', (a) => a.repo_full_name === repoFullName && !currentSlugs.includes(a.slug));
      await db.commit();
    },

    async updateAppHealth(slug, health, testing) {
      const app = findApp(slug);
      if (!app) return;
      db.update('repo_apps', app, {
        has_ci: health.hasCi, has_tests: health.hasTests, has_readme: health.hasReadme,
        readme_lines: health.readmeLines, loc: health.loc, file_count: health.fileCount,
        docs_quality: health.docsQuality, last_health_check: db.now(),
        ...coalesce({ stack: health.stack || null }),
        ...(testing && {
          has_unit_tests: testing.hasUnitTests, has_integration_tests: testing.hasIntegrationTests,
          has_e2e_tests: testing.hasE2eTests, has_lint_config: testing.hasLintConfig,
          has_type_checking: testing.hasTypeChecking, has_security_scan: testing.hasSecurityScan,
          has_perf_tests: testing.hasPerfTests, test_framework: testing.testFramework,
          e2e_framework: testing.e2eFramework, lint_tool: testing.lintTool,
        }),
      });
      await db.commit();
    },
  };
}

// ── Coverage ────────────────────────────────────────

export function createCoverageStore(db: MemoryDb): CoverageStore {
  return {
    async upsertCoverage(fullName, label, coverage, commitSha) {
      if (coverage < 0 || coverage > 100) throw new Error(`Invalid value "${coverage}" for coverage`);
      const report = db.table('coverage_reports').find((c) => c.repo_full_name === fullName && c.label === label);
      const values = { coverage, commit_sha: commitSha ?? null, reported_at: db.now() };
      if (report) db.update('coverage_reports', report, values);
      else db.insert('coverage_reports', { repo_full_name: fullName, label, ...values });
      await db.commit();
    },

    async updateRepoCoverage(fullName, coverage) {
      const repo = db.table('repos').find((r) => r.full_name === fullName);
      if (!repo) return;
      const now = db.now();
      db.update('repos', repo, {
        test_coverage: coverage, has_tests: true,
        coverage_updated_at: now, coverage_source: 'ci', last_health_check: now,
      });
      await db.commit();
    },

    async listCoverageReports(fullName) {
      return db.table('coverage_reports')
        .filter((c) => c.repo_full_name === fullName)
        .sort((a, b) => compareText(a.label, b.label))
        .map((c) => pick(c, ['label', 'coverage', 'commit_sha', 'reported_at']));
    },
  };
}

// ── Metrics history ─────────────────────────────────

const REPO_METRIC_FIELDS = [
  'snapshot_date', 'repo_size_kb', 'file_count', 'loc',
  'stars', 'forks', 'watchers', 'subscribers_count', 'open_issues',
  'has_ci', 'has_tests', 'has_readme', 'readme_lines', 'docs_quality', 'docs_file_count',
] as const;

export function createMetricsStore(db: MemoryDb): MetricsStore {
  const history = () => db.table('repo_metrics_history');
  const byDate = (a: Row, b: Row) => compareText(a.snapshot_date, b.snapshot_date);

  /** Latest snapshot per repo among `rows`. */
  const latestPerRepo = (rows: Row[]): Map<string, Row> => {
    const latest = new Map<string, Row>();
    for (const row of rows) {
      const current = latest.get(row.full_name);
      if (!current || row.snapshot_date > current.snapshot_date) latest.set(row.full_name, row);
    }
    return latest;
  };

  return {
    async getRepoMetrics(fullName, days) {
      const since = addDays(db.today(), -days);
      return history()
        .filter((m) => m.full_name === fullName && m.snapshot_date >= since)
        .sort(byDate)
        .map((m) => pick(m, REPO_METRIC_FIELDS));
    },

    async getSnapshot(date) {
      return history()
        .filter((m) => m.snapshot_date === date)
        .sort((a, b) => compareText(a.full_name, b.full_name))
        .map((m) => pick(m, ['full_name', ...REPO_METRIC_FIELDS, 'language', 'is_private', 'is_archived']));
    },

    async getAggregate(days) {
      const since = addDays(db.today(), -days);
      const byDay = new Map<string, Row[]>();
      for (const m of history()) {
        if (m.snapshot_date < since || m.is_archived !== false) continue;
        byDay.set(m.snapshot_date, [...(byDay.get(m.snapshot_date) ?? []), m]);
      }
      const count = (rows: Row[], test: (r: Row) => boolean) => rows.filter(test).length;
      return [...byDay.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .map(([date, rows]) => ({
          snapshot_date: date,
          total_repos: rows.length,
          total_loc: sum(rows, 'loc'),
          total_files: sum(rows, 'file_count'),
          total_size_kb: sum(rows, 'repo_size_kb'),
          total_stars: sum(rows, 'stars'),
          total_forks: sum(rows, 'forks'),
          total_open_issues: sum(rows, 'open_issues'),
          repos_with_ci: count(rows, (r) => r.has_ci === true),
          repos_with_tests: count(rows, (r) => r.has_tests === true),
          repos_with_readme: count(rows, (r) => r.has_readme === true),
          repos_docs_excellent: count(rows, (r) => r.docs_quality === 'excellent'),
          repos_docs_good: count(rows, (r) => r.docs_quality === 'good'),
          repos_docs_needs_work: count(rows, (r) => r.docs_quality === 'needs_work'),
          repos_docs_missing: count(rows, (r) => r.docs_quality === 'missing'),
        }));
    },

    async getBulkTrends(days) {
      const cutoff = addDays(db.today(), -days);
      const latest = latestPerRepo(history());
      const previous = latestPerRepo(history().filter((m) => m.snapshot_date <= cutoff));
      return [...latest.values()]
        .sort((a, b) => compareText(a.full_name, b.full_name))
        .map((l) => {
          const p = previous.get(l.full_name);
          return {
            full_name: l.full_name,
            loc_delta: minus(l.loc, p?.loc),
            stars_delta: minus(l.stars, p?.stars),
            open_issues_delta: minus(l.open_issues, p?.open_issues),
            current_loc: l.loc ?? null,
            prev_loc: p?.loc ?? null,
            period_days: days,
          };
        });
    },

    async getLatestSnapshotDate() {
      return history().map((m) => m.snapshot_date as string).sort().at(-1) ?? null;
    },

    async compareSnapshots(from, to) {
      const at = (date: string) => new Map(history().filter((m) => m.snapshot_date === date).map((m) => [m.full_name, m]));
      const fromRows = at(from);
      const toRows = at(to);
      const firstSeen = new Map<string, string>();
      for (const m of history()) {
        const first = firstSeen.get(m.full_name);
        if (!first || m.snapshot_date < first) firstSeen.set(m.full_name, m.snapshot_date);
      }

      const names = new Set([...fromRows.keys(), ...toRows.keys()]);
      const diff = (t: Row | undefined, f: Row | undefined, field: string) => (t?.[field] ?? 0) - (f?.[field] ?? 0);

      return [...names]
        .map((name) => {
          const f = fromRows.get(name);
          const t = toRows.get(name);
          return {
            full_name: name,
            loc_delta: diff(t, f, 'loc'),
            file_count_delta: diff(t, f, 'file_count'),
            repo_size_kb_delta: diff(t, f, 'repo_size_kb'),
            stars_delta: diff(t, f, 'stars'),
            forks_delta: diff(t, f, 'forks'),
            open_issues_delta: diff(t, f, 'open_issues'),
            current_loc: t?.loc ?? 0,
            current_file_count: t?.file_count ?? 0,
            current_stars: t?.stars ?? 0,
            from_loc: f?.loc ?? 0,
            is_new: !f && firstSeen.get(name)! > from,
            is_removed: !t,
          };
        })
        .sort((a, b) => Math.abs(b.loc_delta) - Math.abs(a.loc_delta) || compareText(a.full_name, b.full_name));
    },

    async upsertSnapshot(input) {
      const today = db.today();
      const values = {
        repo_size_kb: input.code.sizeKb, file_count: input.code.fileCount, loc: input.code.loc,
        stars: input.github.stars, forks: input.github.forks, watchers: input.github.watchers,
        subscribers_count: input.github.subscribersCount, open_issues: input.github.openIssues,
        has_ci: input.health.hasCi, has_tests: input.health.hasTests, has_readme: input.health.hasReadme,
        readme_lines: input.health.readmeLines, has_gitignore: input.health.hasGitignore,
        has_roadmap: input.health.hasRoadmap, docs_file_count: input.health.docsFileCount,
        docs_quality: input.health.docsQuality,
        language: input.meta.language, is_private: input.meta.isPrivate, is_archived: input.meta.isArchived,
        is_fork: input.meta.isFork, is_template: input.meta.isTemplate, default_branch: input.meta.defaultBranch,
      };
      const existing = history().find((m) => m.repo_id === input.repoId && m.snapshot_date === today);
      if (existing) db.update('repo_metrics_history', existing, values);
      else db.insert('repo_metrics_history', { repo_id: input.repoId, full_name: input.fullName, snapshot_date: today, ...values });
      await db.commit();
    },
  };
}

// ── Services ────────────────────────────────────────

export function createServiceStore(db: MemoryDb): ServiceStore {
  const findService = (slug: string) => db.table('services').find((s) => s.slug === slug);
  const findRepo = (fullName: string | null) => db.table('repos').find((r) => r.full_name === fullName);
  const byName = (a: Row, b: Row) => compareText(a.name, b.name);

  const withRepo = (service: Row, extra: Row = {}): Row => {
    const repo = findRepo(service.source_repo_full_name);
    return { ...clone(service), repo_language: repo?.language ?? null, repo_stack: repo?.stack ?? null, ...extra };
  };

  return {
    async listServices(filters) {
      return db.table('services')
        .filter((s) =>
          (!filters.provider || s.provider === filters.provider) &&
          (!filters.env || s.env === filters.env) &&
          (!filters.sourceRepo || s.source_repo_full_name === filters.sourceRepo) &&
          (filters.isActive === undefined || s.is_active === (filters.isActive === 'true')))
        .sort(byName)
        .map((s) => withRepo(s));
    },

    async getService(slug) {
      const service = findService(slug);
      if (!service) return null;
      return withRepo(service, { repo_description: findRepo(service.source_repo_full_name)?.description ?? null });
    },

    async getServiceBasic(slug) {
      const service = findService(slug);
      return service ? { id: service.id, url: service.url, name: service.name } : null;
    },

    async getServiceForDelete(slug) {
      const service = findService(slug);
      return service ? { id: service.id, name: service.name } : null;
    },

    async listActiveServices() {
      return db.table('services')
        .filter((s) => s.is_active === true && s.url !== null)
        .map((s) => ({ slug: s.slug, url: s.url, name: s.name }));
    },

    async listServicesByRepo(fullName) {
      return db.table('services')
        .filter((s) => s.source_repo_full_name === fullName && s.is_active === true)
        .sort(byName)
        .map((s) => clone(s));
    },

    async createService(data) {
      if (findService(data.slug)) throw uniqueViolation('services_slug_key');
      const service = db.insert('services', {
        name: data.name, slug: data.slug, url: data.url || null, provider: data.provider,
        project: data.project || null, region: data.region || null, env: data.env || 'production',
        source_repo_full_name: data.source_repo_full_name || null,
        source_path: data.source_path || null, description: data.description || null,
      });
      await db.commit();
      return { id: service.id, slug: service.slug };
    },

    async updateService(slug, fields) {
      const service = findService(slug);
      if (!service) return;
      db.update('services', service, coalesce({
        name: fields.name || null, url: fields.url || null, provider: fields.provider || null,
        project: fields.project || null, region: fields.region || null, env: fields.env || null,
        source_repo_full_name: fields.source_repo_full_name || null,
        source_path: fields.source_path || null, description: fields.description || null,
        is_active: fields.is_active,
      }));
      await db.commit();
    },

    async deleteService(slug) {
      db.remove('services', (s) => s.slug === slug);
      await db.commit();
    },

    async updateHealthCheck(slug, status, responseMs, httpCode) {
      const service = findService(slug);
      if (!service) return;
      db.update('services', service, {
        last_check_at: db.now(), last_check_status: status,
        last_check_response_ms: responseMs, last_check_http_code: httpCode,
      });
      await db.commit();
    },

    async syncFromRepos() {
      let updatedCount = 0;
      for (const service of db.table('services')) {
        const repo = findRepo(service.source_repo_full_name);
        if (service.url === null && repo && hasHomepage(repo)) {
          db.update('services', service, { url: repo.homepage });
          updatedCount++;
        }
      }

      let createdCount = 0;
      const linked = new Set(db.table('services').map((s) => s.source_repo_full_name));
      for (const repo of db.table('repos')) {
        if (!hasHomepage(repo) || repo.is_deleted === true || linked.has(repo.full_name)) continue;
        const candidate = serviceFromRepo(repo);
        if (findService(candidate.slug)) continue;
        db.insert('services', candidate);
        createdCount++;
      }

      await db.commit();
      return { updatedCount, createdCount };
    },
  };
}

// ── Activity log ────────────────────────────────────

export function createActivityStore(db: MemoryDb): ActivityStore {
  const newestFirst = (a: Row, b: Row) => (toMillis(b.created_at)! - toMillis(a.created_at)!) || b.id - a.id;

  return {
    async logActivity(params) {
      const row = db.insert('activity_log', {
        action: params.action,
        entity_type: params.entityType,
        entity_id: params.entityId,
        field_changed: params.fieldChanged ?? null,
        old_value: params.oldValue != null ? String(params.oldValue) : null,
        new_value: params.newValue != null ? String(params.newValue) : null,
        actor_type: params.actorType,
        actor_name: params.actorName,
        metadata: params.metadata ?? {},
      });
      await db.commit();
      return formatLogRow(clone(row));
    },

    async listActivities(filters) {
      return db.table('activity_log')
        .filter((a) =>
          (!filters.entityType || a.entity_type === filters.entityType) &&
          (!filters.entityId || a.entity_id === filters.entityId) &&
          (!filters.actorType || a.actor_type === filters.actorType) &&
          (!filters.actorName || a.actor_name === filters.actorName) &&
          (!filters.action || a.action === filters.action))
        .sort(newestFirst)
        .slice(filters.offset, filters.offset + filters.limit)
        .map((a) => clone(a));
    },

    async getStatsByActor() {
      const groups = new Map<string, Row[]>();
      for (const a of db.table('activity_log')) {
        const key = `${a.actor_type}\u0000${a.actor_name}`;
        groups.set(key, [...(groups.get(key) ?? []), a]);
      }
      return [...groups.values()]
        .map((rows) => ({
          actor_type: rows[0].actor_type,
          actor_name: rows[0].actor_name,
          total_actions: rows.length,
          entities_touched: new Set(rows.map((r) => r.entity_id)).size,
          last_activity: rows.map((r) => r.created_at as string).sort().at(-1)!,
        }))
        .sort((a, b) => b.total_actions - a.total_actions || compareText(a.actor_name, b.actor_name));
    },

    async getStatsByDay(days) {
      const since = Date.parse(db.now()) - days * 86_400_000;
      const groups = new Map<string, Row>();
      for (const a of db.table('activity_log')) {
        if (toMillis(a.created_at)! < since) continue;
        const day = (a.created_at as string).slice(0, 10);
        const key = `${day}\u0000${a.actor_type}\u0000${a.actor_name}`;
        const group = groups.get(key) ?? { day, actor_type: a.actor_type, actor_name: a.actor_name, actions: 0 };
        group.actions++;
        groups.set(key, group);
      }
      return [...groups.values()].sort(
        (a, b) => compareText(b.day, a.day) || b.actions - a.actions || compareText(a.actor_name, b.actor_name),
      );
    },

    async getActivityCount(entityType, entityId) {
      return db.table('activity_log').filter((a) =>
        (!entityType || a.entity_type === entityType) && (!entityId || a.entity_id === entityId)).length;
    },

    async getActivitiesByEntity(entityType, entityId, limit) {
      return db.table('activity_log')
        .filter((a) => a.entity_type === entityType && a.entity_id === entityId)
        .sort(newestFirst)
        .slice(0, limit)
        .map((a) => clone(a));
    },
  };
}
