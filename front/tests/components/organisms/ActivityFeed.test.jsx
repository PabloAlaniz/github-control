import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityFeed } from '@/components/organisms/ActivityFeed/ActivityFeed';

global.fetch = vi.fn();

describe('ActivityFeed', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockActivities = [
        {
            id: 1,
            action: 'PUSH',
            actorName: 'alex',
            actorType: 'agent',
            repoFullName: 'owner/repo',
            details: { commits: 1 },
            createdAt: '2026-02-10T10:00:00Z'
        },
        {
            id: 2,
            action: 'CREATE_PR',
            actorName: 'release-bot',
            actorType: 'agent',
            repoFullName: 'owner/repo2',
            details: { prNumber: 1 },
            createdAt: '2026-02-10T09:00:00Z'
        }
    ];

    const mockStats = [
        { actorName: 'alex', actorType: 'agent', totalActions: 10 },
        { actorName: 'release-bot', actorType: 'agent', totalActions: 5 }
    ];

    it('renders loading state initially', () => {
        fetch.mockImplementation(() => new Promise(() => {})); // Never resolves
        render(<ActivityFeed />);
        
        expect(screen.getByText('Loading activity...')).toBeInTheDocument();
    });

    it('renders activities after successful fetch', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: mockStats })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.queryByText('Loading activity...')).not.toBeInTheDocument();
        });

        expect(screen.getByText('Activity Log')).toBeInTheDocument();
    });

    it('renders error state on fetch failure', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: false,
                json: () => Promise.resolve({})
            })
        );

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.getByText(/Failed to load activity/)).toBeInTheDocument();
        });
    });

    it('renders empty state when no activities', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity?')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([])
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: [] })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.getByText('No activity yet')).toBeInTheDocument();
        });
    });

    it('fetches repo-specific activities when repoFullName provided', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/repos/owner/repo/activity')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
        });

        render(<ActivityFeed repoFullName="owner/repo" />);

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/repos/owner/repo/activity'),
                expect.any(Object)
            );
        });

        await waitFor(() => {
            expect(screen.getByText('Repo Activity')).toBeInTheDocument();
        });
    });

    it('applies limit parameter to fetch', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([])
            })
        );

        render(<ActivityFeed limit={50} />);

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('limit=50'),
                expect.any(Object)
            );
        });
    });

    it('shows filter dropdown when stats available', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity?')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: mockStats })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            const select = screen.getByRole('combobox');
            expect(select).toBeInTheDocument();
        });

        // Check options
        await waitFor(() => {
            expect(screen.getByText(/alex \(10\)/)).toBeInTheDocument();
            expect(screen.getByText(/release-bot \(5\)/)).toBeInTheDocument();
        });
    });

    it('filters activities by actor', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity?')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: mockStats })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'alex' } });

        await waitFor(() => {
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('actorName=alex'),
                expect.any(Object)
            );
        });
    });

    it('refreshes activities when refresh button clicked', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: [] })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.queryByText('Loading activity...')).not.toBeInTheDocument();
        });

        const initialFetchCount = fetch.mock.calls.length;
        
        const refreshButton = screen.getByRole('button');
        fireEvent.click(refreshButton);

        await waitFor(() => {
            expect(fetch.mock.calls.length).toBeGreaterThan(initialFetchCount);
        });
    });

    it('hides filters when showFilters is false', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([])
            })
        );

        render(<ActivityFeed showFilters={false} />);

        await waitFor(() => {
            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });
    });

    it('displays stats footer when available', async () => {
        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity?')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ actors: mockStats })
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            expect(screen.getByText(/alex: 10/)).toBeInTheDocument();
            expect(screen.getByText(/release-bot: 5/)).toBeInTheDocument();
        });
    });

    it('handles object response format with activities array', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                    activities: mockActivities,
                    total: 2
                })
            })
        );

        render(<ActivityFeed repoFullName="owner/repo" />);

        await waitFor(() => {
            expect(screen.queryByText('Loading activity...')).not.toBeInTheDocument();
        });
    });

    it('applies custom className', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([])
            })
        );

        const { container } = render(<ActivityFeed className="custom-class" />);

        await waitFor(() => {
            expect(container.querySelector('.custom-class')).toBeInTheDocument();
        });
    });

    it('does not fetch stats when repoFullName is provided', async () => {
        fetch.mockImplementation(() => 
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([])
            })
        );

        render(<ActivityFeed repoFullName="owner/repo" />);

        await waitFor(() => {
            const calls = fetch.mock.calls.map(call => call[0]);
            expect(calls.some(url => url.includes('/by-actor'))).toBe(false);
        });
    });

    it('limits displayed stats to 5 items', async () => {
        const manyStats = Array.from({ length: 10 }, (_, i) => ({
            actorName: `actor${i}`,
            actorType: 'agent',
            totalActions: i + 1
        }));

        fetch.mockImplementation((url) => {
            if (url.includes('/api/activity?')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(mockActivities)
                });
            }
            if (url.includes('/api/activity/stats/by-actor')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(manyStats)
                });
            }
        });

        render(<ActivityFeed />);

        await waitFor(() => {
            const statsElements = screen.queryAllByText(/actor\d+: \d+/);
            expect(statsElements.length).toBeLessThanOrEqual(5);
        });
    });
});
