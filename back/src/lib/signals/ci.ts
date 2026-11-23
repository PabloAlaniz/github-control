import type { SignalCollector } from './types';
import { isUnavailable } from './types';

export interface RunInput {
  workflowId: number | string;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  headSha: string;
  attempt: number;
  url: string | null;
}

const DAY_MS = 86_400_000;
const DAILY_WINDOW = 14;
/** Longer durations are not real execution time (runs that hung or were retried days later). */
const MAX_DURATION_SEC = 6 * 3600;

const FAILURES = new Set(['failure', 'timed_out', 'startup_failure']);
/** Only success or failure count toward the rate: cancelled and skipped runs say nothing about the code. */
const outcome = (run: RunInput): 'success' | 'failure' | null => {
  if (run.status !== 'completed') return null;
  if (run.conclusion === 'success') return 'success';
  return FAILURES.has(run.conclusion ?? '') ? 'failure' : null;
};

function durationSec(run: RunInput): number | null {
  if (!run.startedAt || !run.updatedAt) return null;
  const sec = (new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime()) / 1000;
  return sec > 0 && sec <= MAX_DURATION_SEC ? sec : null;
}

const pct = (ok: number, total: number) => (total > 0 ? Math.round((ok / total) * 100) : null);
const avg = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

interface Stats { runs: number; success: number; failure: number; durations: number[]; flakyKeys: Set<string> }
const emptyStats = (): Stats => ({ runs: 0, success: 0, failure: 0, durations: [], flakyKeys: new Set() });

/**
 * CI metrics from a sample of runs. Pure function.
 * Flaky = a single commit that both failed and passed in the same workflow, or
 * that only passed on a retry: the code did not change, the result did.
 */
export function analyzeRuns(runs: RunInput[], now: number = Date.now()) {
  const total = emptyStats();
  const byWorkflow = new Map<string, Stats & { name: string; last: RunInput | null }>();
  const outcomesByCommit = new Map<string, Set<string>>();
  const daily = new Map<string, { success: number; failure: number }>();
  for (let i = DAILY_WINDOW - 1; i >= 0; i--) {
    daily.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), { success: 0, failure: 0 });
  }

  let oldest = now;
  for (const run of runs) {
    const key = String(run.workflowId);
    const wf = byWorkflow.get(key) ?? { ...emptyStats(), name: run.name, last: null };
    byWorkflow.set(key, wf);
    // The API returns runs newest to oldest: the first one seen is the latest.
    wf.last ??= run;
    if (run.startedAt) oldest = Math.min(oldest, new Date(run.startedAt).getTime());

    const result = outcome(run);
    if (!result) continue;
    for (const stats of [total, wf]) {
      stats.runs++;
      stats[result]++;
    }
    const duration = durationSec(run);
    if (duration !== null) { total.durations.push(duration); wf.durations.push(duration); }

    const commitKey = `${key}:${run.headSha}`;
    const seen = outcomesByCommit.get(commitKey) ?? new Set<string>();
    seen.add(result);
    outcomesByCommit.set(commitKey, seen);
    if ((result === 'success' && run.attempt > 1) || seen.size > 1) {
      total.flakyKeys.add(commitKey);
      wf.flakyKeys.add(commitKey);
    }

    const day = daily.get((run.startedAt ?? '').slice(0, 10));
    if (day) day[result]++;
  }

  return {
    sampled: runs.length,
    counted: total.runs,
    windowDays: runs.length ? Math.max(1, Math.ceil((now - oldest) / DAY_MS)) : 0,
    successRate: pct(total.success, total.runs),
    avgDurationSec: avg(total.durations),
    totalMinutes: Math.round(total.durations.reduce((a, b) => a + b, 0) / 60),
    flaky: total.flakyKeys.size,
    workflows: [...byWorkflow.values()]
      .map(wf => ({
        name: wf.name,
        runs: wf.runs,
        successRate: pct(wf.success, wf.runs),
        avgDurationSec: avg(wf.durations),
        flaky: wf.flakyKeys.size,
        lastConclusion: wf.last?.status === 'completed' ? wf.last.conclusion : wf.last?.status ?? null,
        lastUrl: wf.last?.url ?? null,
      }))
      .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
      .slice(0, 12),
    daily: [...daily.entries()].map(([date, counts]) => ({ date, ...counts })),
  };
}

const SAMPLE_SIZE = 100;

/** CI reliability and cost over the repo's last 100 workflow runs. */
export const collectCi: SignalCollector = async ({ octokit, owner, repo }) => {
  let rawRuns: any[] = [];
  try {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, per_page: SAMPLE_SIZE });
    rawRuns = data.workflow_runs ?? [];
  } catch (err: any) {
    if (!isUnavailable(err)) throw err;
    return { available: false };
  }

  const runs: RunInput[] = rawRuns.map(r => ({
    workflowId: r.workflow_id,
    name: r.name ?? r.path ?? 'workflow',
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    startedAt: r.run_started_at ?? r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    headSha: r.head_sha,
    attempt: r.run_attempt ?? 1,
    url: r.html_url ?? null,
  }));

  return { available: true, ...analyzeRuns(runs), truncated: rawRuns.length === SAMPLE_SIZE };
};
