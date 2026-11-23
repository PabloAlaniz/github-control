import type { AppContext } from '../application/context';
import { getReposWithMetrics } from '../lib/github';

export interface RefreshResult {
  synced: number;
  total: number;
  removed: number;
  removedRepos?: string[];
  restoredRepos?: string[];
  timestamp: string;
}

/** Fetch all repos from GitHub and sync to DB. Returns sync stats. */
export async function refreshFromGitHub(ctx: AppContext): Promise<RefreshResult> {
  const repos = await getReposWithMetrics(ctx.config);

  if (repos.length === 0) {
    return { synced: 0, total: 0, removed: 0, timestamp: new Date().toISOString() };
  }

  const { removedRepos, restoredRepos } = await ctx.storage.repos.refreshFromGitHub(repos);

  return {
    synced: repos.length,
    total: repos.length,
    removed: removedRepos.length,
    ...(removedRepos.length > 0 && { removedRepos }),
    ...(restoredRepos.length > 0 && { restoredRepos }),
    timestamp: new Date().toISOString(),
  };
}
