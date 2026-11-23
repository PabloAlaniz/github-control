import type { AppContext } from '../application/context';
import { getRepoTraffic } from '../lib/github/traffic';

/**
 * Saves the traffic GitHub currently reports for a repo. GitHub drops it after
 * 14 days, so calling this regularly is what builds the history.
 * Returns false when the token has no access to the repo's traffic.
 */
export async function syncRepoTraffic(ctx: AppContext, owner: string, repo: string): Promise<boolean> {
  const traffic = await getRepoTraffic(ctx.config, owner, repo);
  if (!traffic) return false;

  const fullName = `${owner}/${repo}`;
  const today = new Date().toISOString().slice(0, 10);
  await ctx.storage.traffic.upsertDaily(fullName, traffic.days);
  await ctx.storage.traffic.replaceSources(fullName, today, 'referrer', traffic.referrers);
  await ctx.storage.traffic.replaceSources(fullName, today, 'path', traffic.paths);
  return true;
}
