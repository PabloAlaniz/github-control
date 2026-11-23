import type { AppConfig } from '../../config';
import { getOctokit } from './client';

export interface LatestWorkflowRun {
  status: string;       // 'completed', 'in_progress', 'queued', etc.
  conclusion: string | null;  // 'success', 'failure', 'cancelled', etc.
  html_url: string;
  run_at: string;       // ISO date of run start
  name: string;
  branch: string | null;
}

/**
 * Returns the latest workflow run for `owner/repo`, or null if there are none.
 * Latest is defined by GitHub's default ordering (created_at desc, default branch only).
 * Errors (non-404) are logged and return null so callers can fail soft.
 */
export async function getLatestWorkflowRun(
  env: AppConfig,
  owner: string,
  repo: string,
): Promise<LatestWorkflowRun | null> {
  const octokit = getOctokit(env);
  try {
    // Get default branch first to filter runs.
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const branch = repoData.default_branch;
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      per_page: 1,
    });
    const run = data.workflow_runs[0];
    if (!run) return null;
    return {
      status: run.status ?? 'unknown',
      conclusion: run.conclusion ?? null,
      html_url: run.html_url,
      run_at: run.run_started_at ?? run.created_at,
      name: run.name ?? run.path ?? 'workflow',
      branch: run.head_branch ?? null,
    };
  } catch (err: any) {
    if (err.status === 404) return null;  // No workflows configured.
    console.warn(`getLatestWorkflowRun failed for ${owner}/${repo}: ${err.message}`);
    return null;
  }
}

/**
 * Distills a workflow run into a single status used by the UI badge.
 * Mirrors GitHub's "conclusion" when the run is completed; falls back to status otherwise.
 */
export function deriveCiStatus(run: LatestWorkflowRun | null): string | null {
  if (!run) return null;
  if (run.status === 'completed') return run.conclusion ?? 'neutral';
  return run.status;  // 'in_progress', 'queued', etc.
}
