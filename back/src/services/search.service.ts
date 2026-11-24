/**
 * Code search across the repos the dashboard tracks. Unlike the rest of the
 * dashboard this asks GitHub live: code is not something a sync can cache.
 */
import type { AppContext } from '../application/context';
import { searchCode, SearchError, type CodeHit } from '../lib/github/search';

/** GitHub rejects queries with too many qualifiers; beyond this many owners the search is narrowed to the first ones. */
const MAX_OWNERS = 15;
/** Qualifiers that choose where to search. The dashboard sets these itself. */
const SCOPE_QUALIFIER = /(^|\s)-?(user|org|repo|owner):\S+/gi;

export interface CodeSearchOptions {
  /** Only this repo (`owner/name`). */
  repo?: string;
  language?: string;
}

export interface CodeSearchResult {
  query: string;
  /** Files GitHub found in all; only the first page is listed. */
  total: number;
  shown: number;
  incomplete: boolean;
  /** Owners that were left out because there are too many to search at once. */
  ownersSkipped: string[];
  repos: { repo: string; files: Omit<CodeHit, 'repo'>[] }[];
}

/** The GitHub query for `terms`, scoped to the given owners or to one repo. */
export function buildCodeQuery(terms: string, scope: { owners: string[] } | { repo: string }, language?: string): string {
  const cleaned = terms.replace(SCOPE_QUALIFIER, ' ').replace(/\s+/g, ' ').trim();
  const where = 'repo' in scope ? [`repo:${scope.repo}`] : scope.owners.map((owner) => `user:${owner}`);
  const lang = language?.trim() ? [`language:${language.trim().replace(/\s+/g, '-')}`] : [];
  return [cleaned, ...lang, ...where].join(' ');
}

export async function searchTrackedCode(ctx: AppContext, terms: string, options: CodeSearchOptions = {}): Promise<CodeSearchResult> {
  const repos = await ctx.storage.repos.listRepos();
  const tracked = new Set(repos.map((repo) => repo.full_name as string));

  if (options.repo && !tracked.has(options.repo)) throw new SearchError(`Not an active repo here: ${options.repo}`, 400);
  const owners = [...new Set(repos.map((repo) => String(repo.full_name).split('/')[0]))].sort();
  if (owners.length === 0) return { query: terms, total: 0, shown: 0, incomplete: false, ownersSkipped: [], repos: [] };

  const query = buildCodeQuery(terms, options.repo ? { repo: options.repo } : { owners: owners.slice(0, MAX_OWNERS) }, options.language);
  if (!query.replace(/(^|\s)(user|repo|language):\S+/g, '').trim()) {
    throw new SearchError('Type at least one word to look for.', 400);
  }
  const page = await searchCode(ctx.config, query);

  // An owner's repos the dashboard does not track (archived, paused, never synced) stay out.
  const byRepo = new Map<string, Omit<CodeHit, 'repo'>[]>();
  for (const { repo, ...file } of page.hits) {
    if (!tracked.has(repo)) continue;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), file]);
  }
  const grouped = [...byRepo.entries()].map(([repo, files]) => ({ repo, files }));
  return {
    query: terms,
    total: page.total,
    shown: grouped.reduce((sum, group) => sum + group.files.length, 0),
    incomplete: page.incomplete,
    ownersSkipped: options.repo ? [] : owners.slice(MAX_OWNERS),
    repos: grouped,
  };
}
