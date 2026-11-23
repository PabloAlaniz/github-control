import { BASELINE_SETTINGS } from '../../domain/repo-baseline';
import type { SignalCollector } from './types';
import type { Baseline } from '../../domain/repo-baseline';

export interface ConfigSetting {
  key: string;
  label: string;
  expected: boolean;
  /** null = GitHub did not return the field (the token lacks sufficient permission on the repo). */
  actual: boolean | null;
  drift: boolean;
}

/** Compares a repo's configuration against the baseline. Pure function. */
export function diffConfig(
  repoData: Record<string, unknown>,
  baseline: Baseline,
) {
  const settings: ConfigSetting[] = Object.entries(baseline).map(([key, { expected, label }]) => {
    const raw = repoData[key];
    const actual = typeof raw === 'boolean' ? raw : null;
    return { key, label, expected, actual, drift: actual !== null && actual !== expected };
  });
  const archived = repoData.archived === true;
  const permissions = repoData.permissions as { admin?: boolean } | undefined;

  return {
    /** An archived repo is read-only: there is no point asking it for changes. */
    applicable: !archived,
    canApply: !archived && permissions?.admin === true,
    drift: archived ? 0 : settings.filter(s => s.drift).length,
    unknown: settings.filter(s => s.actual === null).length,
    settings,
    // Every setting the baseline could enforce, so a change of policy can be previewed without asking GitHub again.
    actuals: Object.fromEntries(BASELINE_SETTINGS.map(({ key }) => [key, typeof repoData[key] === 'boolean' ? repoData[key] : null])),
  };
}

/** The repo's GitHub configuration compared with the configured baseline. */
export const collectConfig: SignalCollector = async (ctx) => diffConfig(await ctx.repoInfo(), ctx.baseline);
