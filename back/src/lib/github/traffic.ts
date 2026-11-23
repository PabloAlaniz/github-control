import type { AppConfig } from '../../config';
import type { TrafficDay, TrafficSource } from '../../application/ports/storage';
import { getOctokit } from './client';

export interface RepoTraffic {
  /** Views and clones per UTC day, for the (up to) 14 days GitHub keeps. */
  days: TrafficDay[];
  referrers: TrafficSource[];
  paths: TrafficSource[];
}

/**
 * Fetches the traffic GitHub currently has for a repo. Returns null when the
 * token cannot see it: traffic requires push access to the repository.
 */
export async function getRepoTraffic(env: AppConfig, owner: string, repo: string): Promise<RepoTraffic | null> {
  const octokit = getOctokit(env);
  try {
    const [views, clones, referrers, paths] = await Promise.all([
      octokit.repos.getViews({ owner, repo, per: 'day' }),
      octokit.repos.getClones({ owner, repo, per: 'day' }),
      octokit.repos.getTopReferrers({ owner, repo }),
      octokit.repos.getTopPaths({ owner, repo }),
    ]);

    const byDay = new Map<string, TrafficDay>();
    const dayOf = (timestamp: string) => {
      const day = timestamp.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { day, views: 0, views_unique: 0, clones: 0, clones_unique: 0 });
      return byDay.get(day)!;
    };
    for (const v of views.data.views ?? []) Object.assign(dayOf(v.timestamp), { views: v.count, views_unique: v.uniques });
    for (const c of clones.data.clones ?? []) Object.assign(dayOf(c.timestamp), { clones: c.count, clones_unique: c.uniques });

    return {
      days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
      referrers: referrers.data.map((r) => ({ label: r.referrer, hits: r.count, uniques: r.uniques })),
      paths: paths.data.map((p) => ({ label: p.path, title: p.title, hits: p.count, uniques: p.uniques })),
    };
  } catch (error: any) {
    if (error.status === 403 || error.status === 404) return null;
    throw error;
  }
}
