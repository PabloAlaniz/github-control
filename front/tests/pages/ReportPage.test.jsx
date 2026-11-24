import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ReportPage } from '@/pages/ReportPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';

vi.mock('react-router-dom', () => ({ useNavigate: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/components/templates/DashboardLayout', () => ({
    DashboardLayout: ({ stats, children }) => <div>{stats}{children}</div>,
}));

const report = {
    days: 7, from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00.000Z',
    highlights: ['CI is failing on me/api.', '2 releases published.'],
    repos: { total: 3, added: [{ repo: 'me/new', addedAt: '2026-01-05T00:00:00.000Z' }] },
    growth: { stars: 12, loc: -340, topStars: [{ repo: 'me/api', delta: 12 }], topLoc: [{ repo: 'me/web', delta: -340 }] },
    releases: [
        { repo: 'me/api', tag: 'v1.2.0', url: 'https://github.com/me/api/releases/tag/v1.2.0', publishedAt: '2026-01-06T00:00:00.000Z' },
        { repo: 'me/web', tag: 'v0.9.0', url: null, publishedAt: '2026-01-07T00:00:00.000Z' },
    ],
    alerts: { opened: 3, resolved: 1, open: Array.from({ length: 12 }, (_, i) => ({ kind: 'ci_failing', title: `Alert ${i}` })) },
    inbox: { openPrs: 5, openIssues: 8, prsOpened: 1, issuesOpened: 2, readyToMerge: 2 },
    ci: { failing: ['me/api'] },
    services: [{ name: 'API', uptimePct: 99.5, incidents: 1 }, { name: 'Docs', uptimePct: null, incidents: 0 }],
    traffic: { views: 1200, previousViews: 1000, clones: 40 },
};
const quiet = {
    ...report, highlights: ['A quiet stretch: nothing notable this week.'], repos: { total: 3, added: [] },
    growth: { stars: 0, loc: 0, topStars: [], topLoc: [] }, releases: [], alerts: { opened: 0, resolved: 0, open: [] },
    ci: { failing: [] }, services: [], traffic: { views: 0, previousViews: 0, clones: 0 },
};
const respond = (body, ok = true, status = 200) => Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

describe('ReportPage', () => {
    const navigate = vi.fn();
    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(navigate);
    });

    it('leads with the highlights and details each area', async () => {
        api.apiFetch.mockImplementation(() => respond(report));
        render(<ReportPage />);

        const highlights = await screen.findByRole('list', { name: 'Highlights' });
        expect(within(highlights).getAllByRole('listitem').map((li) => li.textContent)).toEqual(report.highlights);
        expect(api.apiFetch).toHaveBeenCalledWith('/api/report?days=7');
        expect(screen.getAllByText('+12')).toHaveLength(2);
        expect(screen.getByText('-340 lines')).toBeInTheDocument();
        expect(screen.getByText(/Views are up 20% on the period before \(1,000\)/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'v1.2.0' })).toHaveAttribute('href', report.releases[0].url);
        expect(screen.getByText('v0.9.0')).toBeInTheDocument();
        expect(screen.getByText('Alerts (3 opened, 1 resolved)')).toBeInTheDocument();
        expect(screen.getByText('…and 2 more')).toBeInTheDocument();
        expect(screen.getByText('99.5% up')).toBeInTheDocument();
        expect(screen.getByText('1 incident')).toBeInTheDocument();
        expect(screen.getByText('no checks')).toBeInTheDocument();
        expect(screen.getByText('New repos: me/new.')).toBeInTheDocument();
        expect(screen.getByText(/1 pull request, 2 issues/)).toBeInTheDocument();
    });

    it('reads another period and goes back', async () => {
        api.apiFetch.mockImplementation(() => respond(report));
        render(<ReportPage />);
        await screen.findByRole('list', { name: 'Highlights' });

        fireEvent.change(screen.getByLabelText('Period'), { target: { value: '30' } });
        await waitFor(() => expect(api.apiFetch).toHaveBeenCalledWith('/api/report?days=30'));
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('says so when nothing happened', async () => {
        api.apiFetch.mockImplementation(() => respond(quiet));
        render(<ReportPage />);

        expect(await screen.findByText('A quiet stretch: nothing notable this week.')).toBeInTheDocument();
        expect(screen.getByText('Nothing open.')).toBeInTheDocument();
        expect(screen.getByText('None published in the period.')).toBeInTheDocument();
        expect(screen.getByText('No repo has a failing build.')).toBeInTheDocument();
        expect(screen.getByText('No services are monitored.')).toBeInTheDocument();
        expect(screen.queryByText(/Views are/)).not.toBeInTheDocument();
    });

    it('offers a retry when it cannot load', async () => {
        api.apiFetch.mockImplementationOnce(() => respond({ error: 'boom' }, false, 500)).mockImplementation(() => respond(report));
        render(<ReportPage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
        expect(await screen.findByRole('list', { name: 'Highlights' })).toBeInTheDocument();
    });
});
