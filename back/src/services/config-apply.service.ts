import type { AppConfig } from '../config';
import { resolveBaseline } from '../domain/repo-baseline';
import { getOctokit } from '../lib/github/client';
import { diffConfig } from '../lib/signals/config';

export interface AppliedSetting { key: string; label: string; from: boolean; to: boolean }

export class ConfigApplyError extends Error {
  constructor(message: string, public status: 404 | 409 | 403 | 502) {
    super(message);
  }
}

/**
 * Brings a repo's configuration to the baseline. Reads the current state from
 * GitHub (not the cached one) and changes only what differs; `keys` limits it
 * to a subset. Returns what changed.
 */
export async function applyBaseline(config: AppConfig, owner: string, repo: string, keys?: string[]): Promise<AppliedSetting[]> {
  const octokit = getOctokit(config);
  const fullName = `${owner}/${repo}`;

  let repoData: Record<string, unknown>;
  try {
    repoData = (await octokit.repos.get({ owner, repo })).data as unknown as Record<string, unknown>;
  } catch (err: any) {
    throw new ConfigApplyError(`Could not read ${fullName}: ${err?.message ?? 'unknown error'}`, err?.status === 404 ? 404 : 502);
  }

  const diff = diffConfig(repoData, resolveBaseline(config.REPO_BASELINE));
  if (!diff.applicable) throw new ConfigApplyError(`${fullName} is archived and cannot be changed`, 409);

  const pending = diff.settings.filter(s => s.drift && (!keys || keys.includes(s.key)));
  if (pending.length === 0) return [];

  const patch = Object.fromEntries(pending.map(s => [s.key, s.expected]));
  try {
    await octokit.repos.update({ owner, repo, ...patch });
  } catch (err: any) {
    if (err?.status === 403 || err?.status === 404) {
      throw new ConfigApplyError(`The token cannot change settings of ${fullName} (admin access required)`, 403);
    }
    throw new ConfigApplyError(`GitHub rejected the change for ${fullName}: ${err?.message ?? 'unknown error'}`, 502);
  }

  return pending.map(s => ({ key: s.key, label: s.label, from: s.actual as boolean, to: s.expected }));
}
