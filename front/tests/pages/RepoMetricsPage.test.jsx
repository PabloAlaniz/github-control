import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RepoMetricsPage } from '@/pages/RepoMetricsPage';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ owner: 'me', repo: 'api' }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const snapshot = {
    date: '2026-11-22',
    code: { loc: 1000, fileCount: 20, sizeKb: 300 },
    github: { stars: 3, forks: 1, openIssues: 2 },
    health: { hasCi: true, hasTests: true, hasReadme: true, docsQuality: 'good', readmeLines: 40 },
};
const ci = {
    available: true, sampled: 42, truncated: false, counted: 40, windowDays: 30,
    successRate: 88, avgDurationSec: 125, totalMinutes: 83, flaky: 1,
    daily: [{ date: '2026-11-22', success: 2, failure: 1 }],
    workflows: [{ name: 'CI', runs: 40, successRate: 88, avgDurationSec: 125, flaky: 1, lastConclusion: 'success', lastUrl: null }],
};
const respond = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('RepoMetricsPage', () => {
    const mockApi = (signals, signalsOk = true) => api.apiFetch.mockImplementation((path) => (
        path.includes('/signals') ? respond({ signals }, signalsOk) : respond({ snapshots: [snapshot] })
    ));

    beforeEach(() => vi.clearAllMocks());

    it('shows the CI reliability section when the signal is synced', async () => {
        mockApi({ ci });
        render(<RepoMetricsPage />);

        await waitFor(() => expect(screen.getByText('CI reliability')).toBeInTheDocument());
        expect(api.apiFetch).toHaveBeenCalledWith('/api/repos/me/api/signals');
        expect(screen.getByText('Last 42 workflow runs over 30 days')).toBeInTheDocument();
        expect(screen.getByText('88%', { selector: 'p, span, div, h1, h2, h3' })).toBeInTheDocument();
        expect(screen.getByText('2m 5s', { selector: 'p, span, div, h1, h2, h3' })).toBeInTheDocument();
        expect(screen.getByText('83 min')).toBeInTheDocument();
        expect(screen.getByTitle('2026-11-22: 2 passed, 1 failed')).toBeInTheDocument();
    });

    it.each([
        ['the signal was never synced', {}, true],
        ['Actions is unavailable', { ci: { available: false } }, true],
        ['there are no runs', { ci: { available: true, sampled: 0 } }, true],
        ['the signals request fails', {}, false],
    ])('hides the CI section when %s', async (_label, signals, ok) => {
        mockApi(signals, ok);
        render(<RepoMetricsPage />);

        await waitFor(() => expect(screen.getByText('Current Health')).toBeInTheDocument());
        expect(screen.queryByText('CI reliability')).not.toBeInTheDocument();
    });
});
