/** In-memory stores for repos and everything that hangs off a repo record. */
import type {
  GroupStore, HealthStore, MetaStore, RepoStore, Row,
} from '../../../application/ports/storage';
import { isActiveRepo, PATCHABLE_META_FIELDS, toMillis } from '../../../domain/repos';
import { isRepoColumn } from '../schema';
import { clone, compareText, uniqueViolation, type MemoryDb } from './db';

const isTrue = (value: unknown) => value === true;

function findRepo(db: MemoryDb, fullName: string): Row | undefined {
  return db.table('repos').find((r) => r.full_name === fullName);
}

function groupSlugs(db: MemoryDb, repoId: number): string[] {
  const groupIds = new Set(db.table('repo_groups').filter((e) => e.repo_id === repoId).map((e) => e.group_id));
  return db.table('groups').filter((g) => groupIds.has(g.id)).map((g) => g.slug);
}

function withGroups(db: MemoryDb, repo: Row): Row {
  return { ...clone(repo), groups: groupSlugs(db, repo.id) };
}

function pick(row: Row, fields: readonly string[]): Row {
  const out: Row = {};
  for (const field of fields) out[field] = clone(row[field]);
  return out;
}

/** Descending by timestamp; `nulls` says where unset values go. */
function byTimestampDesc(field: string, nulls: 'first' | 'last') {
  return (a: Row, b: Row): number => {
    const x = toMillis(a[field]);
    const y = toMillis(b[field]);
    if (x === y) return 0;
    if (x === null) return nulls === 'first' ? -1 : 1;
    if (y === null) return nulls === 'first' ? 1 : -1;
    return y - x;
  };
}

/** 'true' -> only matching, 'all' -> no filter, anything else -> exclude. */
function triState(flag: string | undefined, matches: boolean): boolean {
  if (flag === 'true') return matches;
  if (flag === 'all') return true;
  return !matches;
}

// ── Repos ───────────────────────────────────────────

export function createRepoStore(db: MemoryDb): RepoStore {
  const updateRepo = async (fullName: string, values: Row) => {
    const repo = findRepo(db, fullName);
    if (!repo) return;
    db.update('repos', repo, values);
    await db.commit();
  };

  const deleteRepos = (predicate: (repo: Row) => boolean): Row[] => {
    const removed = db.remove('repos', predicate);
    const ids = new Set(removed.map((r) => r.id));
    db.remove('repo_groups', (edge) => ids.has(edge.repo_id));
    return removed;
  };

  return {
    async listRepos(options = {}) {
      return db.table('repos')
        .filter((r) =>
          (options.includeDeleted || !isTrue(r.is_deleted)) &&
          (options.includeArchived || !isTrue(r.is_archived)) &&
          (options.includePaused || r.priority !== 'paused'))
        .sort(byTimestampDesc('repo_updated_at', 'last'))
        .map((r) => withGroups(db, r));
    },

    async getRepo(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? withGroups(db, repo) : null;
    },

    async getLanguage(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { id: repo.id, language: repo.language } : null;
    },

    async filterRepos(filters) {
      const flags: [keyof typeof filters, string][] = [
        ['has_ci', 'has_ci'], ['has_tests', 'has_tests'],
        ['has_readme', 'has_readme'], ['has_roadmap', 'has_roadmap'],
      ];
      return db.table('repos')
        .filter((r) =>
          triState(filters.deleted, isTrue(r.is_deleted)) &&
          triState(filters.archived, isTrue(r.is_archived)) &&
          triState(filters.paused, r.priority === 'paused') &&
          (!filters.stack || r.stack === filters.stack) &&
          (!filters.priority || r.priority === filters.priority) &&
          flags.every(([param, column]) =>
            filters[param] === undefined || r[column] === (filters[param] === 'true')))
        .sort(byTimestampDesc('repo_updated_at', 'first'))
        .map((r) => clone(r));
    },

    async listAllCoverage() {
      return db.table('coverage_reports').map((c) => ({
        repo_full_name: c.repo_full_name, label: c.label, coverage: c.coverage,
      }));
    },

    async listAllAppsEnriched() {
      return db.table('repo_apps')
        .map((app): Row => ({
          ...clone(app),
          coverage_value: db.table('coverage_reports').find(
            (c) => c.repo_full_name === app.repo_full_name && c.label === app.app_name,
          )?.coverage ?? null,
        }))
        .sort((a, b) => compareText(a.app_name, b.app_name));
    },

    async deleteRepo(fullName) {
      deleteRepos((r) => r.full_name === fullName);
      await db.commit();
    },

    updateArchived: (fullName) => updateRepo(fullName, { is_archived: true }),
    updateStatus: (fullName, status) => updateRepo(fullName, { local_status: status }),
    updatePriority: (fullName, priority) => updateRepo(fullName, { priority }),

    async addBlocker(fullName, blocker) {
      const repo = findRepo(db, fullName);
      if (repo) await updateRepo(fullName, { blockers: [...(repo.blockers ?? []), blocker] });
    },

    async removeBlocker(fullName, blocker) {
      const repo = findRepo(db, fullName);
      if (repo) await updateRepo(fullName, { blockers: (repo.blockers ?? []).filter((b: string) => b !== blocker) });
    },

    async listDeleted() {
      return db.table('repos')
        .filter((r) => isTrue(r.is_deleted))
        .sort(byTimestampDesc('deletion_detected_at', 'first'))
        .map((r) => pick(r, ['full_name', 'owner', 'name', 'description', 'deletion_detected_at', 'repo_updated_at']));
    },

    async purgeDeleted(fullName) {
      const removed = deleteRepos((r) => isTrue(r.is_deleted) && (!fullName || r.full_name === fullName));
      await db.commit();
      return removed.map((r) => ({ full_name: r.full_name }));
    },

    async getRepoForValidation(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { priority: repo.priority, is_archived: repo.is_archived, is_deleted: repo.is_deleted } : null;
    },

    async listAllowed() {
      return db.table('repos')
        .filter((r) => r.priority === 'high' && !isTrue(r.is_archived) && !isTrue(r.is_deleted))
        .map((r) => ({ full_name: r.full_name as string }))
        .sort((a, b) => compareText(a.full_name, b.full_name));
    },

    async getStats() {
      const repos = db.table('repos');
      const active = repos.filter(isActiveRepo);
      return {
        total: active.length,
        with_ci: active.filter((r) => isTrue(r.has_ci)).length,
        with_tests: active.filter((r) => isTrue(r.has_tests)).length,
        archived: repos.filter((r) => isTrue(r.is_archived)).length,
        deleted: repos.filter((r) => isTrue(r.is_deleted)).length,
        paused: repos.filter((r) => r.priority === 'paused').length,
      };
    },

    async getCacheStatus() {
      const cached = db.table('repos').map((r) => r.github_cached_at).filter(Boolean).sort();
      return { count: db.table('repos').length, latest: cached.at(-1) ?? null };
    },

    async refreshFromGitHub(repos) {
      if (repos.length === 0) throw new Error('refreshFromGitHub requires at least one repo');
      const now = db.now();

      for (const repo of repos) {
        const fetched: Row = {
          default_branch: repo.default_branch ?? null,
          description: repo.description ?? null,
          is_private: repo.is_private ?? null,
          is_archived: repo.is_archived ?? null,
          language: repo.language ?? null,
          stars: repo.stars ?? 0,
          forks: repo.forks ?? 0,
          watchers: repo.watchers ?? 0,
          open_issues: repo.open_issues ?? 0,
          last_commit_at: repo.last_commit_at ?? null,
          repo_updated_at: repo.repo_updated_at ?? null,
          repo_size_kb: repo.repo_size_kb ?? null,
          topics: repo.topics ?? [],
          license_key: repo.license_key ?? null,
          license_name: repo.license_name ?? null,
          homepage: repo.homepage ?? null,
          is_fork: repo.is_fork ?? false,
          parent_repo: repo.parent_repo ?? null,
          has_issues: repo.has_issues ?? null,
          has_projects: repo.has_projects ?? null,
          has_wiki: repo.has_wiki ?? null,
          has_pages: repo.has_pages ?? null,
          has_discussions: repo.has_discussions ?? null,
          subscribers_count: repo.subscribers_count ?? 0,
          is_template: repo.is_template ?? false,
          github_cached_at: now,
        };
        const existing = findRepo(db, repo.full_name);
        if (existing) {
          db.update('repos', existing, fetched);
        } else {
          db.insert('repos', {
            ...fetched,
            full_name: repo.full_name,
            owner: repo.owner,
            name: repo.name,
            repo_created_at: repo.repo_created_at ?? null,
          });
        }
      }

      const present = new Set(repos.map((r) => r.full_name));
      const removedRepos: string[] = [];
      const restoredRepos: string[] = [];
      for (const repo of db.table('repos')) {
        if (!present.has(repo.full_name) && !isTrue(repo.is_deleted)) {
          db.update('repos', repo, { is_deleted: true, deletion_detected_at: now });
          removedRepos.push(repo.full_name);
        } else if (present.has(repo.full_name) && isTrue(repo.is_deleted)) {
          db.update('repos', repo, { is_deleted: false, deletion_detected_at: null });
          restoredRepos.push(repo.full_name);
        }
      }

      await db.commit();
      return { removedRepos, restoredRepos };
    },
  };
}

// ── Groups ──────────────────────────────────────────

export function createGroupStore(db: MemoryDb): GroupStore {
  const findBySlug = (slug: string) => db.table('groups').find((g) => g.slug === slug);

  return {
    async listGroups() {
      const activeRepoIds = new Set(db.table('repos').filter(isActiveRepo).map((r) => r.id));
      return db.table('groups')
        .map((g): Row => ({
          ...clone(g),
          repo_count: db.table('repo_groups').filter((e) => e.group_id === g.id && activeRepoIds.has(e.repo_id)).length,
        }))
        .sort((a, b) => compareText(a.name, b.name));
    },

    async createGroup(slug, name, description, color) {
      if (findBySlug(slug)) throw uniqueViolation('groups_slug_key');
      const group = db.insert('groups', { slug, name, description: description ?? null, color: color || '#6366f1' });
      await db.commit();
      return { id: group.id };
    },

    async updateGroup(id, slug, name, description, color) {
      const group = db.table('groups').find((g) => g.id === id);
      if (!group) return;
      if (db.table('groups').some((g) => g.slug === slug && g.id !== id)) throw uniqueViolation('groups_slug_key');
      db.update('groups', group, { slug, name, description: description ?? null, color: color ?? null });
      await db.commit();
    },

    async deleteGroup(id) {
      db.remove('groups', (g) => g.id === id);
      db.remove('repo_groups', (e) => e.group_id === id);
      await db.commit();
    },

    async upsertGroupBySlug(slug, name, description, color) {
      const values = { name, description: description ?? null, color: color ?? '#6366f1' };
      let group = findBySlug(slug);
      if (group) db.update('groups', group, values);
      else group = db.insert('groups', { slug, ...values });
      await db.commit();
      return { id: group.id };
    },

    async getRepoId(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { id: repo.id } : null;
    },

    async addRepoToGroup(repoId, groupId) {
      if (!db.table('repos').some((r) => r.id === repoId) || !db.table('groups').some((g) => g.id === groupId)) {
        throw new Error('Cannot add repo to group: repo or group does not exist');
      }
      const exists = db.table('repo_groups').some((e) => e.repo_id === repoId && e.group_id === groupId);
      if (!exists) db.insert('repo_groups', { repo_id: repoId, group_id: groupId });
      await db.commit();
    },

    async removeRepoFromGroup(repoId, groupId) {
      db.remove('repo_groups', (e) => e.repo_id === repoId && e.group_id === groupId);
      await db.commit();
    },

    async listAllRepoGroupEdges() {
      const repoName = new Map(db.table('repos').map((r) => [r.id, r.full_name as string]));
      const groupSlug = new Map(db.table('groups').map((g) => [g.id, g.slug as string]));
      return db.table('repo_groups')
        .map((e) => ({ repo_full_name: repoName.get(e.repo_id)!, group_slug: groupSlug.get(e.group_id)! }))
        .sort((a, b) => compareText(a.repo_full_name, b.repo_full_name) || compareText(a.group_slug, b.group_slug));
    },
  };
}

// ── Meta ────────────────────────────────────────────

export function createMetaStore(db: MemoryDb): MetaStore {
  const countBy = <K extends string>(field: K) => {
    const counts = new Map<string, number>();
    for (const repo of db.table('repos').filter(isActiveRepo)) {
      const value = repo[field];
      if (value !== null && value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([value, count]) => ({ [field]: value, count }) as Record<K, string> & { count: number });
  };

  return {
    async getMetaSummary() {
      return { priorities: countBy('priority'), stacks: countBy('stack') };
    },

    async getRepoMeta(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? pick(repo, ['priority', 'next_action', 'blockers', 'client', 'notes', 'production_urls']) : null;
    },

    async patchRepoMeta(fullName, updates) {
      const values: Row = {};
      for (const field of PATCHABLE_META_FIELDS) {
        if (field in updates) values[field] = updates[field];
      }
      if (Object.keys(values).length === 0) return false;
      const repo = findRepo(db, fullName);
      if (repo) {
        db.update('repos', repo, values);
        await db.commit();
      }
      return true;
    },

    async bulkUpdateMeta(updates) {
      for (const { full_name, ...fields } of updates) {
        const unknown = Object.keys(fields).find((key) => !isRepoColumn(key));
        if (unknown) throw new Error(`Unknown repo field: ${unknown}`);
        const repo = findRepo(db, full_name);
        if (repo && Object.keys(fields).length > 0) db.update('repos', repo, fields);
      }
      await db.commit();
    },
  };
}

// ── Health, README and summaries ────────────────────

export function createHealthStore(db: MemoryDb): HealthStore {
  const updateRepo = async (fullName: string, values: Row) => {
    const repo = findRepo(db, fullName);
    if (!repo) return;
    db.update('repos', repo, values);
    await db.commit();
  };

  return {
    updateRepoHealth(fullName, health, stack, docsQuality, details, loc, fileCount) {
      const now = db.now();
      return updateRepo(fullName, {
        has_ci: health.hasCi, has_tests: health.hasTests, has_readme: health.hasReadme,
        has_gitignore: health.hasGitignore, readme_lines: health.readmeLines,
        stack, has_roadmap: health.hasRoadmap, last_health_check: now,
        docs_quality: docsQuality, docs_file_count: health.docsFileCount,
        repo_size_kb: details.size ?? null, default_branch: details.default_branch,
        topics: details.topics ?? [],
        license_key: details.license?.key ?? null, license_name: details.license?.name ?? null,
        homepage: details.homepage ?? null, is_fork: details.fork ?? false,
        parent_repo: details.parent?.full_name ?? null,
        has_issues: details.has_issues ?? null, has_projects: details.has_projects ?? null,
        has_wiki: details.has_wiki ?? null, has_pages: details.has_pages ?? null,
        has_discussions: details.has_discussions ?? null,
        subscribers_count: details.subscribers_count ?? 0, is_template: details.is_template ?? false,
        has_unit_tests: health.hasUnitTests, has_integration_tests: health.hasIntegrationTests,
        has_e2e_tests: health.hasE2eTests, has_lint_config: health.hasLintConfig,
        has_type_checking: health.hasTypeChecking, has_security_scan: health.hasSecurityScan,
        has_perf_tests: health.hasPerfTests,
        test_framework: health.testFramework, e2e_framework: health.e2eFramework, lint_tool: health.lintTool,
        loc: loc ?? null, file_count: fileCount ?? null,
        last_deep_analysis: now, deep_analysis_status: 'completed', last_docs_check: now,
      });
    },

    updateCiStatus(fullName, data) {
      return updateRepo(fullName, {
        ci_status: data.ci_status, ci_status_url: data.ci_status_url,
        ci_status_run_at: data.ci_status_run_at, ci_status_checked_at: db.now(),
      });
    },

    updateManualHealth(fullName, health) {
      const fields = ['has_ci', 'has_tests', 'has_readme', 'has_gitignore', 'test_coverage', 'readme_lines', 'stack', 'has_roadmap'];
      const values: Row = { last_health_check: db.now() };
      for (const field of fields) values[field] = health[field] ?? null;
      return updateRepo(fullName, values);
    },

    async getReadmeContent(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { readme_content: repo.readme_content } : null;
    },

    cacheReadme(fullName, content, lines) {
      return updateRepo(fullName, { readme_content: content, has_readme: lines > 0, readme_lines: lines });
    },

    async getDocs(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { readme_content: repo.readme_content, summary: clone(repo.summary) } : null;
    },

    async getSummary(fullName) {
      const repo = findRepo(db, fullName);
      return repo ? { summary: clone(repo.summary) } : null;
    },

    saveSummary(fullName, summary) {
      return updateRepo(fullName, { summary, last_docs_check: db.now() });
    },

    saveAiSummary(fullName, summary) {
      return updateRepo(fullName, {
        summary,
        summary_generated_at: summary.generated_at,
        summary_model: summary.model,
        summary_tokens_in: summary.tokens_in,
        summary_tokens_out: summary.tokens_out,
        last_docs_check: db.now(),
      });
    },
  };
}
