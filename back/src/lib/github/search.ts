import type { AppConfig } from '../../config';
import { getOctokit } from './client';

export interface CodeMatch {
  /** A piece of the file around the match. */
  text: string;
  /** `[start, end)` of each matched term within `text`. */
  highlights: [number, number][];
}

export interface CodeHit {
  repo: string;
  path: string;
  url: string;
  matches: CodeMatch[];
}

export interface CodeSearchPage {
  /** How many files GitHub found in all, of which `hits` is the first page. */
  total: number;
  /** GitHub ran out of time and the results may be partial. */
  incomplete: boolean;
  hits: CodeHit[];
}

export class SearchError extends Error {
  constructor(message: string, public status: 400 | 429 | 502) {
    super(message);
  }
}

const PAGE_SIZE = 50;

/**
 * GitHub code search, with the text around each match. It searches the default
 * branch of the repos the query's qualifiers allow, and is limited by GitHub to
 * a few requests a minute.
 */
export async function searchCode(config: AppConfig, query: string): Promise<CodeSearchPage> {
  const octokit = getOctokit(config);
  let data: any;
  try {
    ({ data } = await octokit.request('GET /search/code', {
      q: query, per_page: PAGE_SIZE,
      headers: { accept: 'application/vnd.github.text-match+json' },
    }));
  } catch (err: any) {
    if (err?.status === 422) throw new SearchError('GitHub could not run that search. Check the query: it needs at least one word to look for.', 400);
    if (err?.status === 403 || err?.status === 429) {
      throw new SearchError('GitHub is limiting code searches right now (about 10 a minute). Try again in a moment.', 429);
    }
    throw new SearchError(`GitHub search failed: ${err?.message ?? 'unknown error'}`, 502);
  }

  const hits: CodeHit[] = (data.items ?? []).map((item: any) => ({
    repo: item.repository?.full_name ?? '',
    path: item.path,
    url: item.html_url,
    matches: (item.text_matches ?? [])
      // A match can also be in the file's path; only the ones in its content have text worth showing.
      .filter((match: any) => typeof match.fragment === 'string' && (match.property ?? 'content') === 'content')
      .map((match: any) => ({
        text: match.fragment,
        highlights: (match.matches ?? []).map((m: any) => m.indices).filter((i: any) => Array.isArray(i) && i.length === 2),
      })),
  }));
  return { total: data.total_count ?? hits.length, incomplete: data.incomplete_results === true, hits };
}
