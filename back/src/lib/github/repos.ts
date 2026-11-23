import type { AppConfig } from '../../config';
import { getOctokit } from './client';

/**
 * Get the authenticated GitHub user
 * @param env - Cloudflare Worker environment with GitHub token
 * @returns GitHub user object with login, id, avatar_url, etc.
 */
export async function getAuthenticatedUser(env: AppConfig) {
  const octokit = getOctokit(env);
  const { data } = await octokit.users.getAuthenticated();
  return data;
}

const viewerLogins = new Map<string, Promise<string | null>>();

/**
 * The login the token belongs to: who "me" is in the inbox. Asked once per
 * token and process. Null when GitHub cannot be asked.
 */
export function getViewerLogin(env: AppConfig): Promise<string | null> {
  if (env.VIEWER_LOGIN) return Promise.resolve(env.VIEWER_LOGIN);
  let cached = viewerLogins.get(env.GITHUB_TOKEN);
  if (!cached) {
    cached = getAuthenticatedUser(env).then((user) => user.login, () => {
      viewerLogins.delete(env.GITHUB_TOKEN); // do not remember a failure
      return null;
    });
    viewerLogins.set(env.GITHUB_TOKEN, cached);
  }
  return cached;
}

/** Organizations to sync in addition to the authenticated user's repos (GITHUB_ORGS). */
export function configuredOrgs(env: AppConfig): string[] {
  return (env.GITHUB_ORGS ?? '').split(',').map((org) => org.trim()).filter(Boolean);
}

/**
 * Fetch all repositories for the authenticated user and configured organizations
 * 
 * This function combines repos from:
 * - User's own repositories
 * - Repos where user is a collaborator
 * - Repos from the organizations listed in GITHUB_ORGS
 * 
 * Deduplicates repos by full_name to avoid duplicates when user has access through multiple paths.
 * 
 * @param env - Cloudflare Worker environment with GitHub token
 * @returns Array of repository objects with metrics (stars, forks, issues, etc.)
 */
export async function getReposWithMetrics(env: AppConfig) {
  const octokit = getOctokit(env);
  const repos: any[] = [];
  const seenRepos = new Set<string>();

  for await (const response of octokit.paginate.iterator(
    octokit.repos.listForAuthenticatedUser,
    { per_page: 100, sort: 'updated' }
  )) {
    for (const repo of response.data) {
      if (!seenRepos.has(repo.full_name)) {
        seenRepos.add(repo.full_name);
        repos.push(repo);
      }
    }
  }

  for (const org of configuredOrgs(env)) {
    try {
      for await (const response of octokit.paginate.iterator(
        octokit.repos.listForOrg,
        { org, per_page: 100, sort: 'updated' }
      )) {
        for (const repo of response.data) {
          if (!seenRepos.has(repo.full_name)) {
            seenRepos.add(repo.full_name);
            repos.push(repo);
          }
        }
      }
    } catch (error: any) {
      console.warn(`Failed to fetch repos for org ${org}: ${error.message}`);
    }
  }

  return repos.map(repo => ({
    full_name: repo.full_name,
    owner: repo.owner.login,
    name: repo.name,
    description: repo.description,
    is_private: repo.private,
    is_archived: repo.archived,
    language: repo.language,
    default_branch: repo.default_branch,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    open_issues: repo.open_issues_count,
    last_commit_at: repo.pushed_at,
    repo_created_at: repo.created_at,
    repo_updated_at: repo.updated_at,
    repo_size_kb: repo.size,
    topics: repo.topics || [],
    license_key: repo.license?.key || null,
    license_name: repo.license?.name || null,
    homepage: repo.homepage || null,
    is_fork: repo.fork || false,
    parent_repo: repo.parent?.full_name || null,
    has_issues: repo.has_issues,
    has_projects: repo.has_projects,
    has_wiki: repo.has_wiki,
    has_pages: repo.has_pages,
    has_discussions: repo.has_discussions,
    subscribers_count: repo.subscribers_count || 0,
    is_template: repo.is_template || false,
  }));
}

/**
 * Get detailed information about a specific repository
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @returns Full repository object from GitHub API
 */
export async function getRepoDetails(env: AppConfig, owner: string, repo: string) {
  const octokit = getOctokit(env);
  const { data } = await octokit.repos.get({ owner, repo });
  return data;
}

/**
 * Fetch the README file content from a repository
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @returns Object with README content (decoded from base64) and SHA, or null if not found
 */
export async function getRepoReadme(env: AppConfig, owner: string, repo: string) {
  const octokit = getOctokit(env);
  try {
    const { data } = await octokit.repos.getReadme({ owner, repo });
    if (!data.content) return null;
    const content = atob(data.content);
    return { content, sha: data.sha };
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * Archive a repository on GitHub
 * @param env - Cloudflare Worker environment with GitHub token
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 */
export async function archiveRepo(env: AppConfig, owner: string, repo: string) {
  const octokit = getOctokit(env);
  await octokit.repos.update({ owner, repo, archived: true });
}

/**
 * Get all open pull requests authored by the authenticated user
 * @param env - Cloudflare Worker environment with GitHub token
 * @returns Array of PR objects (max 100)
 */
export async function getAllOpenPRs(env: AppConfig) {
  const octokit = getOctokit(env);
  const { data } = await octokit.search.issuesAndPullRequests({
    q: 'is:pr is:open author:@me',
    per_page: 100,
  });
  return data.items;
}
