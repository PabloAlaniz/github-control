import { isoTimestamp, type SqlClient } from './client';
import { activeRepoConditions } from './filters';

// ── List ────────────────────────────────────────────

export async function listRepos(db: SqlClient, options?: {
  includeDeleted?: boolean;
  includeArchived?: boolean;
  includePaused?: boolean;
}) {
  const conditions = activeRepoConditions(options ?? {}, 'r');
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.query(`
    SELECT r.*,
      ${db.dialect.listAgg('g.slug')} as groups
    FROM repos r
    LEFT JOIN repo_groups rg ON r.id = rg.repo_id
    LEFT JOIN groups g ON rg.group_id = g.id
    ${whereClause}
    GROUP BY r.id
    ORDER BY r.repo_updated_at DESC NULLS LAST
  `);
}

export async function listAllCoverage(db: SqlClient) {
  return db.query<{ repo_full_name: string; label: string; coverage: number }>(`
    SELECT repo_full_name, label, coverage FROM coverage_reports
  `);
}

export async function listAllAppsEnriched(db: SqlClient) {
  return db.query(`
    SELECT ra.*,
      cr.coverage as coverage_value
    FROM repo_apps ra
    LEFT JOIN coverage_reports cr
      ON cr.repo_full_name = ra.repo_full_name AND cr.label = ra.app_name
    ORDER BY ra.app_name
  `);
}

export async function getRepo(db: SqlClient, fullName: string) {
  return db.queryOne(`
    SELECT r.*,
      ${db.dialect.listAgg('g.slug')} as groups
    FROM repos r
    LEFT JOIN repo_groups rg ON r.id = rg.repo_id
    LEFT JOIN groups g ON rg.group_id = g.id
    WHERE r.full_name = $1
    GROUP BY r.id
  `, [fullName]);
}

export async function getLanguage(db: SqlClient, fullName: string) {
  return db.queryOne<{ id: number; language: string | null }>(`
    SELECT id, language FROM repos WHERE full_name = $1
  `, [fullName]);
}

// ── Filter ──────────────────────────────────────────

export async function filterRepos(db: SqlClient, filters: {
  stack?: string; priority?: string;
  has_ci?: string; has_tests?: string; has_readme?: string; has_roadmap?: string;
  archived?: string; deleted?: string; paused?: string;
}) {
  const { stack, priority, has_ci, has_tests, has_readme, has_roadmap, archived, deleted, paused } = filters;

  const baseConditions: string[] = [];

  if (deleted === 'true') baseConditions.push('is_deleted = true');
  else if (deleted !== 'all') baseConditions.push('(is_deleted = false OR is_deleted IS NULL)');

  if (archived === 'true') baseConditions.push('is_archived = true');
  else if (archived !== 'all') baseConditions.push('(is_archived = false OR is_archived IS NULL)');

  if (paused === 'true') baseConditions.push("priority = 'paused'");
  else if (paused !== 'all') baseConditions.push("(priority != 'paused' OR priority IS NULL)");

  let sql = `SELECT * FROM repos WHERE ${baseConditions.join(' AND ')}`;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (stack) { sql += ` AND stack = $${paramIndex++}`; params.push(stack); }
  if (priority) { sql += ` AND priority = $${paramIndex++}`; params.push(priority); }
  if (has_ci !== undefined) { sql += ` AND has_ci = $${paramIndex++}`; params.push(has_ci === 'true'); }
  if (has_tests !== undefined) { sql += ` AND has_tests = $${paramIndex++}`; params.push(has_tests === 'true'); }
  if (has_readme !== undefined) { sql += ` AND has_readme = $${paramIndex++}`; params.push(has_readme === 'true'); }
  if (has_roadmap !== undefined) { sql += ` AND has_roadmap = $${paramIndex++}`; params.push(has_roadmap === 'true'); }

  sql += ' ORDER BY repo_updated_at DESC NULLS FIRST';
  return db.query(sql, params);
}

// ── Mutations ───────────────────────────────────────

export async function deleteRepo(db: SqlClient, fullName: string): Promise<void> {
  await db.query(`DELETE FROM repos WHERE full_name = $1`, [fullName]);
}

export async function updateArchived(db: SqlClient, fullName: string): Promise<void> {
  await db.query(`UPDATE repos SET is_archived = true WHERE full_name = $1`, [fullName]);
}

export async function updateStatus(db: SqlClient, fullName: string, status: string): Promise<void> {
  await db.query(`UPDATE repos SET local_status = $1 WHERE full_name = $2`, [status, fullName]);
}

export async function updatePriority(db: SqlClient, fullName: string, priority: string): Promise<void> {
  await db.query(`UPDATE repos SET priority = $1 WHERE full_name = $2`, [priority, fullName]);
}

async function setBlockers(db: SqlClient, fullName: string, change: (blockers: string[]) => string[]) {
  const row = await db.queryOne<{ blockers: string[] | null }>(`SELECT blockers FROM repos WHERE full_name = $1`, [fullName]);
  if (!row) return;
  await db.query(`UPDATE repos SET blockers = $1 WHERE full_name = $2`, [
    db.dialect.listParam(change(row.blockers ?? [])), fullName,
  ]);
}

export async function addBlocker(db: SqlClient, fullName: string, blocker: string): Promise<void> {
  await setBlockers(db, fullName, (blockers) => [...blockers, blocker]);
}

export async function removeBlocker(db: SqlClient, fullName: string, blocker: string): Promise<void> {
  await setBlockers(db, fullName, (blockers) => blockers.filter((b) => b !== blocker));
}

// ── Deleted / Purge ─────────────────────────────────

export async function listDeleted(db: SqlClient) {
  return db.query(`
    SELECT full_name, owner, name, description, deletion_detected_at, repo_updated_at
    FROM repos WHERE is_deleted = true
    ORDER BY deletion_detected_at DESC NULLS FIRST
  `);
}

export async function purgeDeleted(db: SqlClient, fullName?: string) {
  if (fullName) {
    return db.query<{ full_name: string }>('DELETE FROM repos WHERE full_name = $1 AND is_deleted = true RETURNING full_name', [fullName]);
  }
  return db.query<{ full_name: string }>('DELETE FROM repos WHERE is_deleted = true RETURNING full_name');
}

// ── Validation / Allowed ────────────────────────────

export async function getRepoForValidation(db: SqlClient, fullName: string) {
  return db.queryOne<{ priority: string | null; is_archived: boolean; is_deleted: boolean }>(`
    SELECT priority, is_archived, is_deleted FROM repos WHERE full_name = $1
  `, [fullName]);
}

export async function listAllowed(db: SqlClient) {
  return db.query<{ full_name: string }>(`
    SELECT full_name FROM repos
    WHERE priority = 'high'
      AND (is_archived = false OR is_archived IS NULL)
      AND (is_deleted = false OR is_deleted IS NULL)
    ORDER BY full_name
  `);
}

// ── Stats (used by index.ts /api/stats) ─────────────

export async function getStats(db: SqlClient) {
  const conds = activeRepoConditions({}, '');
  const activeFilter = conds.length > 0 ? conds.join(' AND ') : 'true';

  const [row] = await db.query<Record<string, string | number>>(`
    SELECT
      COUNT(*) FILTER (WHERE ${activeFilter}) as total,
      COUNT(*) FILTER (WHERE ${activeFilter} AND has_ci = true) as with_ci,
      COUNT(*) FILTER (WHERE ${activeFilter} AND has_tests = true) as with_tests,
      COUNT(*) FILTER (WHERE is_archived = true) as archived,
      COUNT(*) FILTER (WHERE is_deleted = true) as deleted,
      COUNT(*) FILTER (WHERE priority = 'paused') as paused
    FROM repos
  `);

  const count = (key: string) => Number(row?.[key] ?? 0);
  return {
    total: count('total'), with_ci: count('with_ci'), with_tests: count('with_tests'),
    archived: count('archived'), deleted: count('deleted'), paused: count('paused'),
  };
}

// ── Cache status ────────────────────────────────────

export async function getCacheStatus(db: SqlClient) {
  const row = await db.queryOne<{ count: string | number; latest: string | null }>(`
    SELECT COUNT(*) as count, MAX(github_cached_at) as latest FROM repos
  `);
  return { count: Number(row?.count ?? 0), latest: row?.latest ?? null };
}

// ── Refresh from GitHub (upsert + soft-delete) ──────

const GITHUB_COLUMNS = [
  'full_name', 'owner', 'name', 'description', 'is_private', 'is_archived',
  'language', 'default_branch', 'stars', 'forks', 'watchers', 'open_issues',
  'last_commit_at', 'repo_created_at', 'repo_updated_at', 'repo_size_kb',
  'topics', 'license_key', 'license_name', 'homepage', 'is_fork', 'parent_repo',
  'has_issues', 'has_projects', 'has_wiki', 'has_pages', 'has_discussions',
  'subscribers_count', 'is_template',
];
/** Set once, when the repo is first seen; never overwritten by a refresh. */
const INSERT_ONLY = new Set(['full_name', 'owner', 'name', 'repo_created_at']);
/** Rows per INSERT, to stay well under the parameter limit of either engine. */
const UPSERT_CHUNK = 200;

function githubParams(repo: any): unknown[] {
  return [
    repo.full_name, repo.owner, repo.name, repo.description ?? null,
    repo.is_private ?? null, repo.is_archived ?? null, repo.language ?? null, repo.default_branch ?? null,
    repo.stars ?? 0, repo.forks ?? 0, repo.watchers ?? 0, repo.open_issues ?? 0,
    isoTimestamp(repo.last_commit_at), isoTimestamp(repo.repo_created_at), isoTimestamp(repo.repo_updated_at),
    repo.repo_size_kb ?? null,
    JSON.stringify(repo.topics ?? []), repo.license_key ?? null, repo.license_name ?? null,
    repo.homepage ?? null, repo.is_fork ?? false, repo.parent_repo ?? null,
    repo.has_issues ?? null, repo.has_projects ?? null, repo.has_wiki ?? null,
    repo.has_pages ?? null, repo.has_discussions ?? null,
    repo.subscribers_count ?? 0, repo.is_template ?? false,
  ];
}

export async function refreshFromGitHub(db: SqlClient, repos: any[]) {
  if (repos.length === 0) throw new Error('refreshFromGitHub requires at least one repo');
  const { now } = db.dialect;
  const width = GITHUB_COLUMNS.length;
  const updates = GITHUB_COLUMNS
    .filter((column) => !INSERT_ONLY.has(column))
    .map((column) => `${column} = EXCLUDED.${column}`);

  const statements = [];
  for (let start = 0; start < repos.length; start += UPSERT_CHUNK) {
    const chunk = repos.slice(start, start + UPSERT_CHUNK);
    const rows = chunk.map((_, i) =>
      `(${GITHUB_COLUMNS.map((__, j) => `$${i * width + j + 1}`).join(', ')}, ${now})`);
    statements.push({
      sql: `
    INSERT INTO repos (${GITHUB_COLUMNS.join(', ')}, github_cached_at)
    VALUES ${rows.join(', ')}
    ON CONFLICT (full_name) DO UPDATE SET
      ${updates.join(',\n      ')},
      github_cached_at = ${now}
  `,
      params: chunk.flatMap(githubParams),
    });
  }

  const fullNames = repos.map(r => r.full_name);
  const placeholders = fullNames.map((_, i) => `$${i + 1}`).join(', ');
  statements.push({
    sql: `
    UPDATE repos
    SET is_deleted = true, deletion_detected_at = ${now}
    WHERE full_name NOT IN (${placeholders})
      AND (is_deleted = false OR is_deleted IS NULL)
    RETURNING full_name
  `,
    params: fullNames,
  });
  statements.push({
    sql: `
    UPDATE repos
    SET is_deleted = false, deletion_detected_at = NULL
    WHERE full_name IN (${placeholders})
      AND is_deleted = true
    RETURNING full_name
  `,
    params: fullNames,
  });

  const results = await db.batch(statements);
  const [softDeleted, restored] = results.slice(-2);

  return {
    removedRepos: softDeleted.map((r) => r.full_name as string),
    restoredRepos: restored.map((r) => r.full_name as string),
  };
}
