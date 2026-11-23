/**
 * GitHub API enricher — fetches metadata that can't be obtained from git clone.
 *
 * Fields: stars, forks, watchers, description, topics, license, homepage,
 * is_fork, is_template, has_discussions, subscribers_count, etc.
 */

import { Octokit } from '@octokit/rest';

export interface GitHubMetadata {
  description: string | null;
  language: string | null;
  default_branch: string;
  stars: number;
  forks: number;
  watchers: number;
  subscribers_count: number;
  open_issues: number;
  topics: string[];
  license_key: string | null;
  license_name: string | null;
  homepage: string | null;
  is_fork: boolean;
  parent_repo: string | null;
  is_template: boolean;
  is_private: boolean;
  is_archived: boolean;
  has_issues: boolean;
  has_projects: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_discussions: boolean;
  repo_size_kb: number;
  last_commit_at: string | null;
  repo_created_at: string | null;
  repo_updated_at: string | null;
}

/** Fetch metadata for a single repo via GitHub API. */
export async function enrichFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<GitHubMetadata> {
  const { data } = await octokit.repos.get({ owner, repo });

  return {
    description: data.description,
    language: data.language,
    default_branch: data.default_branch,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.watchers_count,
    subscribers_count: data.subscribers_count ?? 0,
    open_issues: data.open_issues_count,
    topics: data.topics ?? [],
    license_key: data.license?.key ?? null,
    license_name: data.license?.name ?? null,
    homepage: data.homepage ?? null,
    is_fork: data.fork,
    parent_repo: data.parent?.full_name ?? null,
    is_template: data.is_template ?? false,
    is_private: data.private,
    is_archived: data.archived,
    has_issues: data.has_issues ?? false,
    has_projects: data.has_projects ?? false,
    has_wiki: data.has_wiki ?? false,
    has_pages: data.has_pages ?? false,
    has_discussions: data.has_discussions ?? false,
    repo_size_kb: data.size ?? 0,
    last_commit_at: data.pushed_at,
    repo_created_at: data.created_at,
    repo_updated_at: data.updated_at,
  };
}

/** Batch enrich repos with rate-limit aware delays. */
export async function enrichBatch(
  octokit: Octokit,
  repos: Array<{ owner: string; name: string; full_name: string }>,
  options: { delayMs?: number; onProgress?: (i: number, total: number, fullName: string) => void } = {},
): Promise<Map<string, GitHubMetadata>> {
  const { delayMs = 200, onProgress } = options;
  const results = new Map<string, GitHubMetadata>();

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    try {
      const metadata = await enrichFromGitHub(octokit, repo.owner, repo.name);
      results.set(repo.full_name, metadata);
      onProgress?.(i + 1, repos.length, repo.full_name);
    } catch (err: any) {
      // Check rate limit
      if (err.status === 403 || err.status === 429) {
        const resetAt = err.response?.headers?.['x-ratelimit-reset'];
        if (resetAt) {
          const waitMs = Math.max(0, parseInt(resetAt, 10) * 1000 - Date.now()) + 1000;
          const waitSec = Math.ceil(waitMs / 1000);
          console.warn(`Rate limited. Waiting ${waitSec}s...`);
          await sleep(waitMs);
          // Retry this repo
          i--;
          continue;
        }
      }
      console.warn(`GitHub enrich failed for ${repo.full_name}: ${err.message}`);
    }

    if (i < repos.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
