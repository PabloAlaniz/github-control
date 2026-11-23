/** Repo rules shared by every layer. Pure: no storage or HTTP imports. */

type Repo = Record<string, any>;

/** A repo is active when it is not deleted, not archived and not paused. */
export function isActiveRepo(repo: Repo): boolean {
  return !repo.is_deleted && !repo.is_archived && repo.priority !== 'paused';
}

/** Fields a caller may change through the meta endpoints. */
export const PATCHABLE_META_FIELDS = [
  'priority', 'next_action', 'blockers',
  'client', 'notes', 'production_urls', 'has_ci', 'has_tests',
  'test_coverage', 'has_readme', 'has_roadmap', 'has_gitignore',
  'docs_quality', 'stack', 'has_docstrings', 'readme_lines',
  'local_status', 'last_health_check', 'last_docs_check',
] as const;

const PRIORITY_RANK: Record<string, number> = { high: 1, medium: 2, low: 3 };

/** Sort rank of a priority: high first; unset/unknown last. */
export function priorityRank(priority: string | null | undefined): number {
  return (priority && PRIORITY_RANK[priority]) || 4;
}

/** Milliseconds for a timestamp stored as Date or ISO string; null when unset. */
export function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const ms = new Date(value as string | Date).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Comparator: ascending by timestamp, unset values first. */
export function byTimestampNullsFirst(field: string) {
  return (a: Repo, b: Repo): number => {
    const x = toMillis(a[field]);
    const y = toMillis(b[field]);
    if (x === y) return 0;
    if (x === null) return -1;
    if (y === null) return 1;
    return x - y;
  };
}
