import type { SignalCollector } from './types';

const API = 'https://api.securityscorecards.dev/projects/github.com';
const TIMEOUT_MS = 10_000;
const TOP_CHECKS = 5;

export interface ScorecardCheck { name: string; score: number | null; reason: string | null }

/** The parts of an OpenSSF Scorecard result worth keeping. Pure. */
export function summarizeScorecard(result: any) {
  const checks: ScorecardCheck[] = (Array.isArray(result?.checks) ? result.checks : []).map((check: any) => ({
    name: String(check?.name ?? ''),
    // The API reports -1 for a check that could not be evaluated.
    score: typeof check?.score === 'number' && check.score >= 0 ? check.score : null,
    reason: typeof check?.reason === 'string' ? check.reason : null,
  })).filter((check: ScorecardCheck) => check.name);
  const scored = checks.filter((check) => check.score !== null).sort((a, b) => a.score! - b.score!);
  return {
    available: true,
    score: typeof result?.score === 'number' ? result.score : null,
    date: typeof result?.date === 'string' ? result.date : null,
    /** The lowest-scoring checks: where to look first. */
    weakest: scored.slice(0, TOP_CHECKS),
    items: checks,
  };
}

/**
 * The repo's OpenSSF Scorecard, from the project's public API. Only asked when
 * the policy turns it on, and only for public repos: the API knows no others,
 * and asking would send it the name of a private one.
 */
export const collectScorecard: SignalCollector = async (ctx) => {
  if (!ctx.policy.scorecard) return { enabled: false };
  const repo = await ctx.repoInfo();
  if (repo.private !== false) return { enabled: true, available: false, reason: 'private' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API}/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    // 404: the project has not been scanned (it scans a fixed set of repos, plus those that publish results).
    if (response.status === 404) return { enabled: true, available: false, reason: 'not_scanned' };
    if (!response.ok) throw new Error(`OpenSSF Scorecard answered HTTP ${response.status}`);
    return { enabled: true, ...summarizeScorecard(await response.json()) };
  } finally {
    clearTimeout(timeout);
  }
};
