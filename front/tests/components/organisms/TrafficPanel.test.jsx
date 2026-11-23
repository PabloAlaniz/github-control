import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrafficPanel } from '@/components/organisms/TrafficPanel';

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args) => mockApiFetch(...args) }));
vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return { ...actual, ResponsiveContainer: ({ children }) => <div data-testid="chart">{children}</div> };
});

const ok = (body) => ({ ok: true, json: async () => body });
const traffic = {
    repo: 'acme/api', days: 30,
    daily: [
        { day: '2026-03-01', views: 1200, views_unique: 300, clones: 40, clones_unique: 12 },
        { day: '2026-03-02', views: 34, views_unique: 20, clones: 2, clones_unique: 1 },
    ],
    referrers: { day: '2026-03-02', sources: [{ label: 'google.com', title: null, hits: 90, uniques: 40 }] },
    paths: { day: '2026-03-02', sources: [{ label: '/acme/api/issues', title: 'Issues', hits: 55, uniques: 21 }] },
};
const empty = { repo: 'acme/api', days: 30, daily: [], referrers: { day: null, sources: [] }, paths: { day: null, sources: [] } };

describe('TrafficPanel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows totals, charts, referrers and popular paths', async () => {
        mockApiFetch.mockResolvedValue(ok(traffic));
        render(<TrafficPanel owner="acme" repo="api" days="30" />);

        expect(await screen.findByText('1,234')).toBeInTheDocument();          // views
        expect(screen.getByText('320 unique visitors (daily sum)')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();                     // clones
        expect(screen.getAllByTestId('chart')).toHaveLength(2);
        expect(screen.getByText('google.com')).toBeInTheDocument();
        expect(screen.getByText('/acme/api/issues')).toHaveAttribute('title', 'Issues');
        expect(screen.getAllByText('14 days to Mar 02')).toHaveLength(2);
        expect(mockApiFetch).toHaveBeenCalledWith('/api/traffic/repo/acme/api?days=30');
    });

    it('explains the empty state and loads data after a manual sync', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok(empty))
            .mockResolvedValueOnce(ok({ success: true }))
            .mockResolvedValueOnce(ok(traffic));
        const user = userEvent.setup();
        render(<TrafficPanel owner="acme" repo="api" days="30" />);

        expect(await screen.findByText('No traffic recorded yet')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Sync traffic' }));

        expect(await screen.findByText('1,234')).toBeInTheDocument();
        expect(mockApiFetch).toHaveBeenNthCalledWith(2, '/api/traffic/repo/acme/api/sync', { method: 'POST' });
    });

    it('shows why a sync failed', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok(empty))
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'The token needs push access' }) });
        const user = userEvent.setup();
        render(<TrafficPanel owner="acme" repo="api" days="30" />);

        await user.click(await screen.findByRole('button', { name: 'Sync traffic' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('The token needs push access');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Sync traffic' })).toBeEnabled());
    });

    it('reloads when the time range changes', async () => {
        mockApiFetch.mockResolvedValue(ok(traffic));
        const { rerender } = render(<TrafficPanel owner="acme" repo="api" days="30" />);
        await screen.findByText('1,234');
        rerender(<TrafficPanel owner="acme" repo="api" days="90" />);
        await waitFor(() => expect(mockApiFetch).toHaveBeenLastCalledWith('/api/traffic/repo/acme/api?days=90'));
        expect(screen.getByText('Views, last 90 days')).toBeInTheDocument();
    });
});
