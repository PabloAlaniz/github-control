import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrafficOverview } from '@/components/organisms/TrafficOverview';

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args) => mockApiFetch(...args) }));

const renderOverview = (days = '30') => render(<MemoryRouter><TrafficOverview days={days} /></MemoryRouter>);
const repo = (name, views) => ({ full_name: `acme/${name}`, views, views_unique: Math.round(views / 3), clones: Math.round(views / 10), clones_unique: 1 });

describe('TrafficOverview', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows totals and links the most viewed repos to their metrics page', async () => {
        mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({
            days: 30, totals: { views: 1500, views_unique: 500, clones: 150, clones_unique: 2 }, daily: [],
            repos: [repo('web', 1200), repo('api', 300)],
        }) });
        renderOverview();

        expect(await screen.findByText('Traffic, last 30 days')).toBeInTheDocument();
        expect(screen.getByText('1,500 views')).toBeInTheDocument();
        expect(screen.getByText('150 clones')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'acme/web' })).toHaveAttribute('href', '/metrics/acme/web');
        expect(screen.getAllByRole('row')).toHaveLength(3);
        expect(mockApiFetch).toHaveBeenCalledWith('/api/traffic/summary?days=30');
    });

    it('lists only the top ten and says so', async () => {
        const repos = Array.from({ length: 13 }, (_, i) => repo(`r${i}`, 100 - i));
        mockApiFetch.mockResolvedValue({ ok: true, json: async () => ({ days: 30, totals: { views: 1, views_unique: 1, clones: 0, clones_unique: 0 }, daily: [], repos }) });
        renderOverview();
        expect(await screen.findByText('Showing the 10 most viewed of 13 repositories.')).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(11);
    });

    it('renders nothing without traffic or when the request fails', async () => {
        mockApiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ days: 30, totals: {}, daily: [], repos: [] }) });
        const first = renderOverview();
        await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
        expect(first.container).toBeEmptyDOMElement();

        mockApiFetch.mockRejectedValueOnce(new Error('offline'));
        const second = renderOverview('7');
        await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
        expect(second.container).toBeEmptyDOMElement();
    });
});
