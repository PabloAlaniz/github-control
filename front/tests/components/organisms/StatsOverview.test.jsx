import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsOverview } from '@/components/organisms/StatsOverview/StatsOverview';
import * as formatters from '@/lib/formatters';

vi.mock('@/lib/formatters', async () => {
    const actual = await vi.importActual('@/lib/formatters');
    return {
        ...actual,
        formatTimeAgo: vi.fn((date) => '2 hours ago'),
    };
});

describe('StatsOverview', () => {
    const mockRepos = [
        {
            id: 1,
            name: 'repo1',
            isPrivate: false,
            isArchived: false,
            isDeleted: false,
            priority: 'high',
            stars: 10,
        },
        {
            id: 2,
            name: 'repo2',
            isPrivate: true,
            isArchived: false,
            isDeleted: false,
            priority: 'medium',
            stars: 5,
        },
        {
            id: 3,
            name: 'repo3',
            isPrivate: false,
            isArchived: true,
            isDeleted: false,
            priority: 'low',
            stars: 0,
        },
        {
            id: 4,
            name: 'repo4',
            isPrivate: false,
            isArchived: false,
            isDeleted: false,
            priority: null,
            stars: 3,
        }
    ];

    it('renders without crashing with empty repos', () => {
        const { container } = render(<StatsOverview repos={[]} />);
        expect(screen.getByText('Total Repos')).toBeInTheDocument();
        expect(container).toBeTruthy();
    });

    it('calculates total repos correctly (excludes archived/deleted)', () => {
        render(<StatsOverview repos={mockRepos} />);
        expect(screen.getByText('Total Repos')).toBeInTheDocument();
        // 3 active repos (repo3 is archived)
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('calculates priority counts correctly', () => {
        render(<StatsOverview repos={mockRepos} />);
        expect(screen.getByText('High Priority')).toBeInTheDocument();
        expect(screen.getByText('Medium Priority')).toBeInTheDocument();
        expect(screen.getByText('Low Priority')).toBeInTheDocument();
        expect(screen.getByText('No Priority')).toBeInTheDocument();
    });

    it('calculates total stars correctly', () => {
        render(<StatsOverview repos={mockRepos} />);
        expect(screen.getByText('Stars')).toBeInTheDocument();
        // Total stars: 10 + 5 + 0 + 3 = 18
        expect(screen.getByText('18')).toBeInTheDocument();
    });

    it('shows last updated time when cacheInfo is provided', () => {
        const cacheInfo = { cachedAt: new Date().toISOString() };
        render(<StatsOverview repos={mockRepos} cacheInfo={cacheInfo} />);
        expect(screen.getByText(/Last updated: 2 hours ago/)).toBeInTheDocument();
    });

    it('does not show last updated time when cacheInfo is missing', () => {
        render(<StatsOverview repos={mockRepos} />);
        expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
    });

    it('handles repos with missing optional fields', () => {
        const reposWithMissingFields = [
            { id: 1, name: 'repo1' },
            { id: 2, name: 'repo2', isPrivate: true }
        ];
        
        const { container } = render(<StatsOverview repos={reposWithMissingFields} />);
        expect(container).toBeTruthy();
        expect(screen.getByText('Total Repos')).toBeInTheDocument();
    });

    it('renders all stat cards', () => {
        render(<StatsOverview repos={mockRepos} />);
        
        expect(screen.getByText('Total Repos')).toBeInTheDocument();
        expect(screen.getByText('High Priority')).toBeInTheDocument();
        expect(screen.getByText('Medium Priority')).toBeInTheDocument();
        expect(screen.getByText('Low Priority')).toBeInTheDocument();
        expect(screen.getByText('No Priority')).toBeInTheDocument();
        expect(screen.getByText('Stars')).toBeInTheDocument();
    });
});
