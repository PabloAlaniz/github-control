import { describe, it, expect, vi } from 'vitest';
import { analyzeRuns, collectCi, type RunInput } from '@back/lib/signals/ci';
import { createSignalContext } from '@back/lib/signals';

const NOW = new Date('2026-11-23T12:00:00Z').getTime();
const at = (daysAgo: number, minutes = 0) => new Date(NOW - daysAgo * 86_400_000 + minutes * 60_000).toISOString();

let shaCounter = 0;
const run = (extra: Partial<RunInput> = {}): RunInput => ({
  workflowId: 1, name: 'CI', status: 'completed', conclusion: 'success',
  startedAt: at(1), updatedAt: at(1, 5), headSha: `sha${shaCounter++}`, attempt: 1, url: 'u', ...extra,
});

describe('analyzeRuns', () => {
  it('returns an empty summary without runs', () => {
    const result = analyzeRuns([], NOW);
    expect(result).toMatchObject({
      sampled: 0, counted: 0, windowDays: 0, successRate: null, avgDurationSec: null, totalMinutes: 0, flaky: 0, workflows: [],
    });
    expect(result.daily).toHaveLength(14);
    expect(result.daily.at(-1)).toEqual({ date: '2026-11-23', success: 0, failure: 0 });
  });

  it('computes success rate over success and failure only', () => {
    const result = analyzeRuns([
      run(), run(), run(),
      run({ conclusion: 'failure' }),
      run({ conclusion: 'timed_out' }),
      run({ conclusion: 'cancelled' }),
      run({ conclusion: 'skipped' }),
      run({ status: 'in_progress', conclusion: null }),
    ], NOW);

    expect(result.sampled).toBe(8);
    expect(result.counted).toBe(5);
    expect(result.successRate).toBe(60);
  });

  it('averages duration and totals run time, ignoring implausible durations', () => {
    const result = analyzeRuns([
      run({ startedAt: at(1), updatedAt: at(1, 4) }),
      run({ startedAt: at(1), updatedAt: at(1, 8) }),
      run({ startedAt: at(3), updatedAt: at(1) }),          // 2 days: not real time
      run({ startedAt: at(1), updatedAt: at(1, -1) }),      // negative
      run({ startedAt: null }),
    ], NOW);

    expect(result.avgDurationSec).toBe(360);
    expect(result.totalMinutes).toBe(12);
  });

  it('flags a commit that failed and passed in the same workflow as flaky', () => {
    const result = analyzeRuns([
      run({ headSha: 'abc', conclusion: 'success' }),
      run({ headSha: 'abc', conclusion: 'failure' }),
      run({ headSha: 'abc', conclusion: 'failure' }),
      run({ headSha: 'abc', conclusion: 'success', workflowId: 2, name: 'Deploy' }),
      run({ headSha: 'def', conclusion: 'failure' }),
    ], NOW);

    expect(result.flaky).toBe(1);
    expect(result.workflows.find(w => w.name === 'CI')!.flaky).toBe(1);
    expect(result.workflows.find(w => w.name === 'Deploy')!.flaky).toBe(0);
  });

  it('flags a success on a later attempt as flaky, but not a failed retry', () => {
    const result = analyzeRuns([
      run({ headSha: 'a', attempt: 2 }),
      run({ headSha: 'b', attempt: 3, conclusion: 'failure' }),
    ], NOW);
    expect(result.flaky).toBe(1);
  });

  it('breaks down by workflow, busiest first, with the latest result', () => {
    const result = analyzeRuns([
      run({ workflowId: 2, name: 'Deploy', status: 'in_progress', conclusion: null, url: 'latest-deploy' }),
      run({ workflowId: 2, name: 'Deploy', conclusion: 'failure' }),
      run({ workflowId: 1, conclusion: 'failure', url: 'latest-ci' }),
      run({ workflowId: 1 }),
      run({ workflowId: 1 }),
    ], NOW);

    expect(result.workflows).toEqual([
      { name: 'CI', runs: 3, successRate: 67, avgDurationSec: 300, flaky: 0, lastConclusion: 'failure', lastUrl: 'latest-ci' },
      { name: 'Deploy', runs: 1, successRate: 0, avgDurationSec: 300, flaky: 0, lastConclusion: 'in_progress', lastUrl: 'latest-deploy' },
    ]);
  });

  it('buckets the last 14 days and reports the sample window', () => {
    const result = analyzeRuns([
      run({ startedAt: at(0, -60), updatedAt: at(0, -55) }),
      run({ startedAt: at(2), updatedAt: at(2, 5), conclusion: 'failure' }),
      run({ startedAt: at(40), updatedAt: at(40, 5) }),
    ], NOW);

    expect(result.daily.find(d => d.date === '2026-11-23')).toMatchObject({ success: 1, failure: 0 });
    expect(result.daily.find(d => d.date === '2026-11-21')).toMatchObject({ success: 0, failure: 1 });
    expect(result.daily.reduce((n, d) => n + d.success + d.failure, 0)).toBe(2);
    expect(result.windowDays).toBe(40);
  });

  it('handles a workflow whose only run has no status', () => {
    const result = analyzeRuns([run({ status: null, conclusion: null, url: null })], NOW);
    expect(result.workflows[0]).toMatchObject({ runs: 0, successRate: null, avgDurationSec: null, lastConclusion: null, lastUrl: null });
  });
});

describe('collectCi', () => {
  const collect = (listWorkflowRunsForRepo: any) =>
    collectCi(createSignalContext({ actions: { listWorkflowRunsForRepo } } as any, 'me', 'api')) as Promise<any>;

  it('maps workflow runs from the API', async () => {
    const list = vi.fn().mockResolvedValue({ data: { workflow_runs: [
      { workflow_id: 9, name: 'CI', status: 'completed', conclusion: 'success', run_started_at: at(1), updated_at: at(1, 3), head_sha: 'a', run_attempt: 1, html_url: 'u' },
      { workflow_id: 9, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'failure', created_at: at(2), updated_at: at(2, 3), head_sha: 'b' },
      { workflow_id: 10, head_sha: 'c' },
    ] } });

    const result = await collect(list);

    expect(list).toHaveBeenCalledWith({ owner: 'me', repo: 'api', per_page: 100 });
    expect(result).toMatchObject({ available: true, sampled: 3, counted: 2, successRate: 50, truncated: false });
    expect(result.workflows.map((w: any) => w.name)).toEqual(['CI', 'workflow']);
  });

  it('flags a full sample as truncated', async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({ workflow_id: 1, name: 'CI', status: 'completed', conclusion: 'success', head_sha: `s${i}` }));
    expect((await collect(vi.fn().mockResolvedValue({ data: { workflow_runs: runs } }))).truncated).toBe(true);
  });

  it('tolerates a response without runs', async () => {
    expect(await collect(vi.fn().mockResolvedValue({ data: {} }))).toMatchObject({ available: true, sampled: 0 });
  });

  it('marks CI as unavailable when Actions cannot be read', async () => {
    expect(await collect(vi.fn().mockRejectedValue({ status: 404 }))).toEqual({ available: false });
  });

  it('propagates unexpected errors', async () => {
    await expect(collect(vi.fn().mockRejectedValue({ status: 500 }))).rejects.toEqual({ status: 500 });
  });
});
