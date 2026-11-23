import type { AppConfig } from '../config';
import { getOctokit } from '../lib/github/client';

export interface BranchTarget {
  name: string;
  /** Commit the branch pointed to when it was classified. If it changed, the branch is not deleted. */
  sha: string;
}

export interface BranchDeleteResult {
  name: string;
  deleted: boolean;
  reason?: 'default' | 'protected' | 'moved' | 'gone' | 'error';
  error?: string;
}

/**
 * Deletes branches on GitHub with three safeguards: never the default, never a
 * protected one, and only if the branch still points to the commit the user saw.
 */
export async function deleteBranches(
  config: AppConfig,
  owner: string,
  repo: string,
  targets: BranchTarget[],
): Promise<BranchDeleteResult[]> {
  const octokit = getOctokit(config);
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const results: BranchDeleteResult[] = [];

  for (const { name, sha } of targets) {
    if (name === repoData.default_branch) {
      results.push({ name, deleted: false, reason: 'default' });
      continue;
    }
    try {
      const { data: branch } = await octokit.repos.getBranch({ owner, repo, branch: name });
      if (branch.protected) {
        results.push({ name, deleted: false, reason: 'protected' });
      } else if (branch.commit.sha !== sha) {
        results.push({ name, deleted: false, reason: 'moved' });
      } else {
        await octokit.git.deleteRef({ owner, repo, ref: `heads/${name}` });
        results.push({ name, deleted: true });
      }
    } catch (err: any) {
      if (err?.status === 404) results.push({ name, deleted: false, reason: 'gone' });
      else results.push({ name, deleted: false, reason: 'error', error: err?.message ?? 'unknown error' });
    }
  }
  return results;
}
