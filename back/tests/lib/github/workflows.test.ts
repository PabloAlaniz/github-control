import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockListRuns = vi.fn();

vi.mock('@back/lib/github/client', () => ({
  getOctokit: () => ({
    repos: { get: mockGet },
    actions: { listWorkflowRunsForRepo: mockListRuns },
  }),
}));

import { getLatestWorkflowRun, deriveCiStatus } from '@back/lib/github/workflows';

describe('workflows.deriveCiStatus', () => {
  it('returns null for null run', () => {
    expect(deriveCiStatus(null)).toBeNull();
  });

  it('returns conclusion when status is completed', () => {
    expect(deriveCiStatus({ status: 'completed', conclusion: 'success', html_url: '', run_at: '', name: '', branch: null })).toBe('success');
    expect(deriveCiStatus({ status: 'completed', conclusion: 'failure', html_url: '', run_at: '', name: '', branch: null })).toBe('failure');
  });

  it('returns "neutral" when completed with null conclusion', () => {
    expect(deriveCiStatus({ status: 'completed', conclusion: null, html_url: '', run_at: '', name: '', branch: null })).toBe('neutral');
  });

  it('returns status itself when not completed (in_progress, queued)', () => {
    expect(deriveCiStatus({ status: 'in_progress', conclusion: null, html_url: '', run_at: '', name: '', branch: null })).toBe('in_progress');
    expect(deriveCiStatus({ status: 'queued', conclusion: null, html_url: '', run_at: '', name: '', branch: null })).toBe('queued');
  });
});

describe('workflows.getLatestWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mapped run when GitHub returns one', async () => {
    mockGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockListRuns.mockResolvedValue({
      data: {
        workflow_runs: [{
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/o/r/actions/runs/1',
          run_started_at: '2026-05-06T10:00:00Z',
          created_at: '2026-05-06T09:59:00Z',
          name: 'CI',
          path: '.github/workflows/ci.yml',
          head_branch: 'main',
        }],
      },
    });

    const result = await getLatestWorkflowRun({} as any, 'owner', 'repo');
    expect(result).toEqual({
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/o/r/actions/runs/1',
      run_at: '2026-05-06T10:00:00Z',
      name: 'CI',
      branch: 'main',
    });
  });

  it('returns null when no workflow runs exist', async () => {
    mockGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockListRuns.mockResolvedValue({ data: { workflow_runs: [] } });

    const result = await getLatestWorkflowRun({} as any, 'owner', 'repo');
    expect(result).toBeNull();
  });

  it('returns null on 404 (no workflows configured)', async () => {
    mockGet.mockRejectedValue({ status: 404, message: 'Not Found' });

    const result = await getLatestWorkflowRun({} as any, 'owner', 'repo');
    expect(result).toBeNull();
  });

  it('returns null and logs warning on other errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGet.mockRejectedValue({ status: 500, message: 'Boom' });

    const result = await getLatestWorkflowRun({} as any, 'owner', 'repo');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls back to created_at when run_started_at is missing', async () => {
    mockGet.mockResolvedValue({ data: { default_branch: 'main' } });
    mockListRuns.mockResolvedValue({
      data: {
        workflow_runs: [{
          status: 'completed',
          conclusion: 'success',
          html_url: 'x',
          run_started_at: null,
          created_at: '2026-01-01T00:00:00Z',
          name: null,
          path: '.github/workflows/ci.yml',
          head_branch: null,
        }],
      },
    });

    const result = await getLatestWorkflowRun({} as any, 'owner', 'repo');
    expect(result?.run_at).toBe('2026-01-01T00:00:00Z');
    expect(result?.name).toBe('.github/workflows/ci.yml');
    expect(result?.branch).toBeNull();
  });
});
