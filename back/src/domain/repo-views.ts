/**
 * Predefined repo views (backlog, health, needs-ci, ...).
 *
 * These used to be SQL views. They are plain functions over the list of
 * active repos (with their group slugs), so every storage adapter gets them
 * for free and their rules live in one testable place.
 */
import { byTimestampNullsFirst, isActiveRepo, priorityRank } from './repos';

type Repo = Record<string, any>;

function pick(repo: Repo, fields: readonly string[]): Repo {
  const out: Repo = {};
  for (const field of fields) out[field] = repo[field] ?? null;
  return out;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ViewDefinition {
  where: (repo: Repo) => boolean;
  fields: readonly string[];
  orderBy: (a: Repo, b: Repo) => number;
}

const byPriorityThen = (next: (a: Repo, b: Repo) => number) => (a: Repo, b: Repo) =>
  priorityRank(a.priority) - priorityRank(b.priority) || next(a, b);

const VIEWS = {
  health: {
    where: () => true,
    fields: [
      'full_name', 'has_ci', 'has_tests', 'test_coverage', 'has_readme', 'readme_lines',
      'has_gitignore', 'has_roadmap', 'stack', 'production_urls', 'last_health_check',
      'docs_quality', 'docs_file_count', 'groups',
    ],
    orderBy: byTimestampNullsFirst('last_health_check'),
  },
  'needs-ci': {
    where: (r) => !r.has_ci,
    fields: ['full_name', 'owner', 'name', 'stack', 'last_health_check'],
    orderBy: byTimestampNullsFirst('last_health_check'),
  },
  'needs-tests': {
    where: (r) => !r.has_tests,
    fields: ['full_name', 'owner', 'name', 'stack', 'test_coverage', 'last_health_check'],
    orderBy: byTimestampNullsFirst('last_health_check'),
  },
  'needs-docs': {
    where: (r) =>
      r.has_readme === false ||
      r.docs_quality === 'needs_work' || r.docs_quality === 'missing' ||
      r.docs_quality === null || r.docs_quality === undefined,
    fields: ['full_name', 'owner', 'name', 'readme_lines', 'docs_quality', 'docs_file_count', 'last_docs_check'],
    orderBy: byTimestampNullsFirst('last_docs_check'),
  },
  'needs-roadmap': {
    where: (r) => !r.has_roadmap,
    fields: ['full_name', 'owner', 'name', 'stack', 'priority', 'last_health_check'],
    orderBy: byPriorityThen(byTimestampNullsFirst('last_health_check')),
  },
  'almost-done': {
    where: (r) => r.priority === 'high' && r.next_action !== null && r.next_action !== undefined,
    fields: ['full_name', 'owner', 'name', 'priority', 'next_action', 'blockers'],
    orderBy: (a, b) => compareText(a.full_name, b.full_name),
  },
  backlog: {
    where: (r) => r.priority !== null && r.priority !== undefined,
    fields: ['full_name', 'priority', 'next_action', 'blockers', 'has_ci', 'has_tests', 'stack', 'groups'],
    orderBy: byPriorityThen((a, b) => compareText(a.full_name, b.full_name)),
  },
} satisfies Record<string, ViewDefinition>;

export type RepoViewName = keyof typeof VIEWS;

export const REPO_VIEW_NAMES = Object.keys(VIEWS) as RepoViewName[];

/** Applies a view to a list of repos. Inactive repos are always left out. */
export function applyRepoView(name: RepoViewName, repos: Repo[]): Repo[] {
  const view: ViewDefinition = VIEWS[name];
  return repos
    .filter((repo) => isActiveRepo(repo) && view.where(repo))
    .sort(view.orderBy)
    .map((repo) => pick(repo, view.fields));
}
