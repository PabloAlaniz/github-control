import { runCustomChecks } from '../../domain/policy';
import type { SignalCollector } from './types';

/**
 * The policy's custom checks for this repo: one result per check, by id. The
 * health score reads them from here, so a check added to the policy counts
 * once the repo is synced again.
 */
export const collectPolicy: SignalCollector = async (ctx) => {
  const { checks } = ctx.policy;
  if (checks.length === 0) return { checks: [], passed: 0, total: 0 };

  const [paths, repo] = await Promise.all([ctx.tree(), ctx.repoInfo()]);
  const results = runCustomChecks(checks, { paths, isPrivate: repo.private === true });
  const counted = results.filter((result) => result.passed !== null);
  return {
    checks: results.map((result) => ({ ...result, label: checks.find((check) => check.id === result.id)!.label })),
    passed: counted.filter((result) => result.passed).length,
    total: counted.length,
  };
};
