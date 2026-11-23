import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MetricsPage } from '@/pages/MetricsPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
    apiFetch: vi.fn(),
}));

vi.mock('@/components/templates/DashboardLayout', () => ({
    DashboardLayout: ({ stats, children }) => (
        <div data-testid="layout">
            <div data-testid="stats">{stats}</div>
            <div data-testid="content">{children}</div>
        </div>
    ),
}));

vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
    };
});

const mockSnapshots = [
    {
        date: '2026-02-20',
        totalRepos: 25,
        code: { totalLoc: 100000, totalFiles: 500, totalSizeKb: 50000 },
        github: { totalStars: 50, totalForks: 10, totalOpenIssues: 5 },
        health: { reposWithCi: 20, reposWithTests: 15, reposWithReadme: 23, docsQuality: { excellent: 10, good: 8, needsWork: 5, missing: 2 } },
    },
    {
        date: '2026-02-26',
        totalRepos: 26,
        code: { totalLoc: 105000, totalFiles: 520, totalSizeKb: 52000 },
        github: { totalStars: 55, totalForks: 12, totalOpenIssues: 3 },
        health: { reposWithCi: 21, reposWithTests: 16, reposWithReadme: 24, docsQuality: { excellent: 11, good: 8, needsWork: 5, missing: 2 } },
    },
];

const mockCompare = {
    from: '2026-02-20',
    to: '2026-02-26',
    changes: [
        {
            repo: 'owner/repo-a',
            deltas: { loc: 5000, fileCount: 20, sizeKb: 100, stars: 2, forks: 1, openIssues: 0 },
            current: { loc: 50000, fileCount: 200, stars: 10, fromLoc: 45000 },
            isNew: false,
            isRemoved: false,
        },
        {
            repo: 'owner/new-repo',
            deltas: { loc: 12000, fileCount: 100, sizeKb: 500, stars: 0, forks: 0, openIssues: 0 },
            current: { loc: 12000, fileCount: 100, stars: 0, fromLoc: 0 },
            isNew: true,
            isRemoved: false,
        },
    ],
};

function mockApiFetchWithData(snapshots = mockSnapshots, compare = mockCompare, latestSnapshot = '2026-02-26T10:00:00Z') {
    api.apiFetch.mockImplementation((url) => {
        if (url.startsWith('/api/metrics/aggregate')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ snapshots }),
            });
        }
        if (url === '/api/metrics/latest') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ latestSnapshot }),
            });
        }
        if (url.startsWith('/api/metrics/compare')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(compare),
            });
        }
        return Promise.resolve({ ok: false });
    });
}

function mockApiFetchEmpty() {
    api.apiFetch.mockImplementation((url) => {
        if (url.startsWith('/api/metrics/aggregate')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ snapshots: [] }),
            });
        }
        if (url === '/api/metrics/latest') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ latestSnapshot: null }),
            });
        }
        return Promise.resolve({ ok: false });
    });
}

describe('MetricsPage', () => {
    const mockNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(mockNavigate);
    });

    it('renders loading state initially', () => {
        // apiFetch never resolves so it stays in loading
        api.apiFetch.mockReturnValue(new Promise(() => {}));
        render(<MetricsPage />);

        expect(screen.getByText('Loading metrics...')).toBeInTheDocument();
    });

    it('renders empty state when no data', async () => {
        mockApiFetchEmpty();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('No Data Available')).toBeInTheDocument();
        });
        expect(screen.getByText(/Run the daily snapshot script/)).toBeInTheDocument();
        expect(screen.getByText('node scripts/daily-snapshot.js')).toBeInTheDocument();
    });

    it('renders summary cards with correct data', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Total Repositories')).toBeInTheDocument();
        });

        // Total Repos - 26 appears in summary card and trends table
        expect(screen.getByText('Total Repositories')).toBeInTheDocument();
        expect(screen.getAllByText('26').length).toBeGreaterThanOrEqual(1);

        // Lines of Code - 105,000 appears in summary card and trends table
        expect(screen.getByText('Lines of Code')).toBeInTheDocument();
        expect(screen.getAllByText('105,000').length).toBeGreaterThanOrEqual(1);

        // Total Stars - 55 appears in summary card and trends table
        expect(screen.getByText('Total Stars')).toBeInTheDocument();
        expect(screen.getAllByText('55').length).toBeGreaterThanOrEqual(1);

        // Code Files - 520 appears in summary card and trends table
        expect(screen.getByText('Code Files')).toBeInTheDocument();
        expect(screen.getAllByText('520').length).toBeGreaterThanOrEqual(1);
    });

    it('renders health overview section', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Repository Health')).toBeInTheDocument();
        });

        expect(screen.getByText('With CI')).toBeInTheDocument();
        expect(screen.getAllByText('21').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('With Tests')).toBeInTheDocument();
        expect(screen.getAllByText('16').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('With README')).toBeInTheDocument();
        expect(screen.getAllByText('24').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Excellent Docs')).toBeInTheDocument();
        expect(screen.getAllByText('11').length).toBeGreaterThanOrEqual(1);
    });

    it('renders trends detail table with snapshot data', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Trends Detail')).toBeInTheDocument();
        });

        // The table shows aggregateData reversed, so both snapshot rows should appear
        expect(screen.getByText('25')).toBeInTheDocument(); // first snapshot totalRepos
        expect(screen.getByText('100,000')).toBeInTheDocument(); // first snapshot LOC
    });

    it('time range selector changes trigger refetch', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Total Repositories')).toBeInTheDocument();
        });

        // Initially fetches with default timeRange=30
        expect(api.apiFetch).toHaveBeenCalledWith('/api/metrics/aggregate?days=30');

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '7' } });

        await waitFor(() => {
            expect(api.apiFetch).toHaveBeenCalledWith('/api/metrics/aggregate?days=7');
        });
    });

    it('back button calls navigate("/")', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Total Repositories')).toBeInTheDocument();
        });

        const backButton = screen.getByText('Back').closest('button');
        fireEvent.click(backButton);

        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('repo activity section renders when compare data available', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText('Repo Activity')).toBeInTheDocument();
        });

        // repo-a should appear in the activity table (not new, not removed, fromLoc > 0)
        expect(screen.getByText('owner/repo-a')).toBeInTheDocument();
    });

    it('new repos section shows repos with isNew flag', async () => {
        mockApiFetchWithData();
        render(<MetricsPage />);

        await waitFor(() => {
            expect(screen.getByText(/New repos added in this period/)).toBeInTheDocument();
        });

        // The new-repo should appear with "New" label
        expect(screen.getByText('new-repo')).toBeInTheDocument();
        expect(screen.getByText('12,000 LOC')).toBeInTheDocument();
    });
});
