import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActivityPage } from '@/pages/ActivityPage';
import * as router from 'react-router-dom';
import * as api from '@/lib/api';
import * as auth from '@/lib/auth';

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
    apiFetch: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
    logout: vi.fn(),
}));

vi.mock('@/components/templates/DashboardLayout', () => ({
    DashboardLayout: ({ stats, children }) => (
        <div data-testid="layout">
            <div data-testid="stats">{stats}</div>
            <div data-testid="content">{children}</div>
        </div>
    ),
}));

vi.mock('@/components/organisms/ActivityFeed', () => ({
    ActivityFeed: ({ limit, showFilters }) => (
        <div data-testid="activity-feed" data-limit={limit} data-show-filters={String(showFilters)}>
            Activity Feed
        </div>
    ),
}));

const mockActorStats = [
    { actorName: 'bot-1', actorType: 'agent', totalActions: 30 },
    { actorName: 'alice', actorType: 'human', totalActions: 20 },
];

const mockDailyStats = [
    { day: '2026-02-25', actions: 15 },
    { day: '2026-02-26', actions: 10 },
];

function mockApiFetchWithData() {
    api.apiFetch.mockImplementation((url) => {
        if (url === '/api/activity/stats/by-actor') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ actors: mockActorStats }),
            });
        }
        if (url.startsWith('/api/activity/stats/by-day')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ days: mockDailyStats }),
            });
        }
        return Promise.resolve({ ok: false });
    });
}

describe('ActivityPage', () => {
    const mockNavigate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        router.useNavigate.mockReturnValue(mockNavigate);
    });

    it('renders loading state with ActivityFeed', () => {
        api.apiFetch.mockReturnValue(new Promise(() => {}));
        render(<ActivityPage />);

        expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
        expect(screen.getByTestId('activity-feed')).toHaveAttribute('data-limit', '50');
        expect(screen.getByTestId('activity-feed')).toHaveAttribute('data-show-filters', 'true');
    });

    it('renders stats cards with calculated values', async () => {
        mockApiFetchWithData();
        render(<ActivityPage />);

        await waitFor(() => {
            expect(screen.getByText('50')).toBeInTheDocument(); // totalActions = 30 + 20
        });

        // Total Actions
        expect(screen.getByText('Total Actions')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();

        // By Agents - 30 appears in stats card and leaderboard, so use getAllByText
        expect(screen.getByText('By Agents')).toBeInTheDocument();
        expect(screen.getAllByText('30').length).toBeGreaterThanOrEqual(1);

        // By Humans - 20 appears in stats card and leaderboard
        expect(screen.getByText('By Humans')).toBeInTheDocument();
        expect(screen.getAllByText('20').length).toBeGreaterThanOrEqual(1);

        // Actors count
        expect(screen.getByText('Actors')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders leaderboard with actor data', async () => {
        mockApiFetchWithData();
        render(<ActivityPage />);

        await waitFor(() => {
            expect(screen.getByText('Leaderboard')).toBeInTheDocument();
        });

        expect(screen.getByText('bot-1')).toBeInTheDocument();
        expect(screen.getByText('alice')).toBeInTheDocument();
        expect(screen.getByText('#1')).toBeInTheDocument();
        expect(screen.getByText('#2')).toBeInTheDocument();
    });

    it('renders daily stats bars', async () => {
        mockApiFetchWithData();
        render(<ActivityPage />);

        await waitFor(() => {
            expect(screen.getByText('Last 7 Days')).toBeInTheDocument();
        });

        // Daily action counts should appear as text
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
    });

    it('back button calls navigate("/")', async () => {
        mockApiFetchWithData();
        render(<ActivityPage />);

        await waitFor(() => {
            expect(screen.getByText('50')).toBeInTheDocument();
        });

        const backButton = screen.getByText('Back').closest('button');
        fireEvent.click(backButton);

        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('logout button calls logout() and navigate("/login")', async () => {
        mockApiFetchWithData();
        render(<ActivityPage />);

        await waitFor(() => {
            expect(screen.getByText('50')).toBeInTheDocument();
        });

        const logoutButton = screen.getByText('Logout').closest('button');
        fireEvent.click(logoutButton);

        expect(auth.logout).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
});
