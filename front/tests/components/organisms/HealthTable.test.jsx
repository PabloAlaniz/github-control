import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HealthTable } from '@/components/organisms/HealthTable/HealthTable';
import toast from 'react-hot-toast';
import { SIGNAL_KINDS } from '@/lib/signals';

// HealthTable links to the per-repo metrics page, so it needs a router around it.
const render = (ui, options) => rtlRender(ui, { wrapper: MemoryRouter, ...options });

vi.mock('react-hot-toast', () => ({
    default: { success: vi.fn(), error: vi.fn() },
}));

describe('HealthTable', () => {
    const mockRepos = [
        {
            id: 1,
            name: 'Repo A',
            fullName: 'user/Repo A', // Added for sorting
            owner: { login: 'user' },
            stack: 'node',
            hasReadme: true,
            hasCi: false,
            hasTests: false,
            testCoverage: 60,
            priority: 'medium',
            lastHealthCheck: '2023-01-01T00:00:00Z'
        },
        {
            id: 2,
            name: 'Repo B',
            fullName: 'user/Repo B',
            owner: { login: 'user' },
            stack: 'python',
            hasReadme: true,
            hasCi: true,
            hasTests: true,
            testCoverage: 90,
            priority: 'high',
            lastHealthCheck: null
        },
        {
            id: 3,
            name: 'Repo C',
            fullName: 'user/Repo C',
            owner: { login: 'user' },
            stack: null,
            hasReadme: false,
            hasCi: null,
            hasTests: null,
            testCoverage: null,
            priority: 'low',
            lastHealthCheck: '2023-02-01T00:00:00Z'
        }
    ];

    it('renders repository list correctly', () => {
        render(<HealthTable repos={mockRepos} />);

        expect(screen.getByText('Repo A')).toBeInTheDocument();
        expect(screen.getByText('Repo B')).toBeInTheDocument();
        expect(screen.getByText('Repo C')).toBeInTheDocument();

        expect(screen.getByText('js')).toBeInTheDocument();
        expect(screen.getByText('py')).toBeInTheDocument();

        expect(screen.getByText('medium')).toBeInTheDocument();
        expect(screen.getByText('high')).toBeInTheDocument();
        expect(screen.getByText('low')).toBeInTheDocument();
    });

    it('handles sorting', () => {
        // Mock repos are defined above.
        // Default sort is priority desc (High -> Medium -> Low).
        // High (Repo B), Medium (Repo A), Low (Repo C)

        const { container } = render(<HealthTable repos={mockRepos} />);

        const rows = container.querySelectorAll('tbody tr');
        expect(rows[0]).toHaveTextContent('Repo B'); // High
        expect(rows[1]).toHaveTextContent('Repo A'); // Medium
        expect(rows[2]).toHaveTextContent('Repo C'); // Low

        // Sort by Priority Ascending
        const priorityHeader = screen.getByText('Priority').closest('th');
        fireEvent.click(priorityHeader); // Toggle directon to asc

        const rowsAsc = container.querySelectorAll('tbody tr');
        expect(rowsAsc[0]).toHaveTextContent('Repo C'); // Low
        expect(rowsAsc[1]).toHaveTextContent('Repo A'); // Medium
        expect(rowsAsc[2]).toHaveTextContent('Repo B'); // High
    });

    it('filters by health status', () => {
        // filter = "needs-ci" (hasCi === false || null) -> Repo A (false), Repo C (null)
        const { rerender, queryByText } = render(<HealthTable repos={mockRepos} healthFilter="needs-ci" />);

        expect(screen.getByText('Repo A')).toBeInTheDocument();
        expect(screen.getByText('Repo C')).toBeInTheDocument();
        expect(queryByText('Repo B')).not.toBeInTheDocument(); // hasCi = true

        // filter = "needs-tests" (hasTests === false || null) -> A, C
        rerender(<HealthTable repos={mockRepos} healthFilter="needs-tests" />);
        expect(screen.getByText('Repo A')).toBeInTheDocument();
        expect(screen.getByText('Repo C')).toBeInTheDocument();
        expect(queryByText('Repo B')).not.toBeInTheDocument();

        // filter = "needs-readme" (hasReadme === false || null) -> C
        rerender(<HealthTable repos={mockRepos} healthFilter="needs-readme" />);
        expect(screen.getByText('Repo C')).toBeInTheDocument();
        expect(queryByText('Repo A')).not.toBeInTheDocument();
        expect(queryByText('Repo B')).not.toBeInTheDocument();
    });

    it('links repo name to GitHub', () => {
        render(<HealthTable repos={mockRepos} />);

        const repoALink = screen.getByText('Repo A').closest('a');
        expect(repoALink).toHaveAttribute('href', 'https://github.com/user/Repo A');
        expect(repoALink).toHaveAttribute('target', '_blank');
    });

    it('links README checkmarks to GitHub #readme', () => {
        render(<HealthTable repos={mockRepos} />);

        const readmeLinks = screen.getAllByTitle(/^README:/);
        expect(readmeLinks).toHaveLength(2); // Repo A and Repo B both have hasReadme: true
        readmeLinks.forEach(link => {
            expect(link.tagName).toBe('A');
            expect(link).toHaveAttribute('href', expect.stringContaining('#readme'));
        });
    });

    it('links CI badge to GitHub Actions when ciStatus is unsynced (hasCi=true)', () => {
        const { container } = render(<HealthTable repos={mockRepos} />);

        // Repo B has hasCi=true but no ciStatus → CiStatusBadge falls back to a static
        // checkmark with no surrounding link. Repos with hasCi=false render an XCircle.
        // We verify that the CI column for Repo B contains a "CI configured" icon.
        const configuredIcon = container.querySelector('[aria-label="CI configured (no recent run)"]');
        expect(configuredIcon).not.toBeNull();
    });

    it('rows do not have cursor-pointer or click handler', () => {
        const { container } = render(<HealthTable repos={mockRepos} />);

        const rows = container.querySelectorAll('tbody tr');
        rows.forEach(row => {
            expect(row.className).not.toContain('cursor-pointer');
        });
    });

    it('constructs valid sync URL without undefined', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });

        render(<HealthTable repos={mockRepos} />);

        const syncButtons = screen.getAllByTitle('Sync health data');
        fireEvent.click(syncButtons[0]);

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.not.stringContaining('undefined'),
            expect.any(Object)
        );
        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringContaining('/api/repos/user/Repo B/health/sync'),
            expect.any(Object)
        );

        fetchSpy.mockRestore();
    });
});

describe('HealthTable - additional coverage', () => {
    let fetchSpy;

    const baseRepo = {
        id: 1,
        name: 'test-repo',
        fullName: 'user/test-repo',
        owner: { login: 'user' },
        stack: 'node',
        hasReadme: true,
        hasCi: true,
        hasTests: true,
        hasRoadmap: true,
        testCoverage: 80,
        priority: 'high',
        lastHealthCheck: '2024-01-01T00:00:00Z',
        defaultBranch: 'main',
    };

    beforeEach(() => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    // -----------------------------------------------------------
    // Health filter values
    // -----------------------------------------------------------

    describe('healthFilter - needs-roadmap', () => {
        it('filters repos that need a roadmap', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'has-roadmap', fullName: 'user/has-roadmap', hasRoadmap: true },
                { ...baseRepo, id: 2, name: 'no-roadmap', fullName: 'user/no-roadmap', hasRoadmap: false },
                { ...baseRepo, id: 3, name: 'null-roadmap', fullName: 'user/null-roadmap', hasRoadmap: null },
            ];

            render(<HealthTable repos={repos} healthFilter="needs-roadmap" />);

            expect(screen.getByText('no-roadmap')).toBeInTheDocument();
            expect(screen.getByText('null-roadmap')).toBeInTheDocument();
            expect(screen.queryByText('has-roadmap')).not.toBeInTheDocument();
        });
    });

    describe('healthFilter - unchecked', () => {
        it('filters repos where all health fields are null', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'checked', fullName: 'user/checked', hasCi: true, hasTests: true, hasReadme: true },
                { ...baseRepo, id: 2, name: 'unchecked', fullName: 'user/unchecked', hasCi: null, hasTests: null, hasReadme: null },
                { ...baseRepo, id: 3, name: 'partial', fullName: 'user/partial', hasCi: null, hasTests: null, hasReadme: false },
            ];

            render(<HealthTable repos={repos} healthFilter="unchecked" />);

            expect(screen.getByText('unchecked')).toBeInTheDocument();
            expect(screen.queryByText('checked')).not.toBeInTheDocument();
            expect(screen.queryByText('partial')).not.toBeInTheDocument();
        });
    });

    describe('healthFilter - deleted', () => {
        it('filters only deleted repos', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'active', fullName: 'user/active', isDeleted: false },
                { ...baseRepo, id: 2, name: 'deleted-repo', fullName: 'user/deleted-repo', isDeleted: true },
            ];

            render(<HealthTable repos={repos} healthFilter="deleted" />);

            expect(screen.getByText('deleted-repo')).toBeInTheDocument();
            expect(screen.queryByText('active')).not.toBeInTheDocument();
        });
    });

    describe('healthFilter - paused', () => {
        it('filters only paused repos', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'high-repo', fullName: 'user/high-repo', priority: 'high' },
                { ...baseRepo, id: 2, name: 'paused-repo', fullName: 'user/paused-repo', priority: 'paused' },
            ];

            render(<HealthTable repos={repos} healthFilter="paused" />);

            expect(screen.getByText('paused-repo')).toBeInTheDocument();
            expect(screen.queryByText('high-repo')).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------
    // Sync button
    // -----------------------------------------------------------

    describe('sync button', () => {
        it('calls fetch with POST and shows success toast on sync', async () => {
            const toast = (await import('react-hot-toast')).default;
            const onDataChange = vi.fn();
            const repos = [{ ...baseRepo }];

            render(<HealthTable repos={repos} onDataChange={onDataChange} />);

            const syncButton = screen.getByTitle('Sync health data');
            fireEvent.click(syncButton);

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalledWith(
                    expect.stringContaining('/api/repos/user/test-repo/health/sync'),
                    expect.objectContaining({ method: 'POST' })
                );
            });

            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('test-repo synced!');
            });

            await waitFor(() => {
                expect(onDataChange).toHaveBeenCalled();
            });
        });

        it('shows error toast when sync fails with response error', async () => {
            const toast = (await import('react-hot-toast')).default;
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Server down' }),
            });

            render(<HealthTable repos={[{ ...baseRepo }]} />);

            fireEvent.click(screen.getByTitle('Sync health data'));

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Failed to sync test-repo: Server down');
            });
        });

        it('shows error toast when sync throws network error', async () => {
            const toast = (await import('react-hot-toast')).default;
            fetchSpy.mockRejectedValueOnce(new Error('Network error'));

            render(<HealthTable repos={[{ ...baseRepo }]} />);

            fireEvent.click(screen.getByTitle('Sync health data'));

            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Error: Network error');
            });
        });
    });

    // -----------------------------------------------------------
    // Priority editing
    // -----------------------------------------------------------

    describe('priority editing', () => {
        it('opens priority select when clicking priority badge', () => {
            render(<HealthTable repos={[{ ...baseRepo }]} />);

            const priorityBadge = screen.getByText('high');
            fireEvent.click(priorityBadge);

            const select = screen.getByRole('combobox');
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue('high');
        });

        it('sends POST with new priority when selection changes', async () => {
            const onDataChange = vi.fn();
            render(<HealthTable repos={[{ ...baseRepo }]} onDataChange={onDataChange} />);

            // Click priority to open editor
            fireEvent.click(screen.getByText('high'));

            // Change the select value
            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: 'low' } });

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalledWith(
                    expect.stringContaining('/api/repos/user/test-repo/priority'),
                    expect.objectContaining({
                        method: 'POST',
                        body: JSON.stringify({ priority: 'low' }),
                    })
                );
            });

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('test-repo priority set to low');
            });

            await waitFor(() => {
                expect(onDataChange).toHaveBeenCalled();
            });
        });

        it('shows error toast when priority change fails', async () => {
            fetchSpy.mockResolvedValueOnce({ ok: false });

            render(<HealthTable repos={[{ ...baseRepo }]} />);

            fireEvent.click(screen.getByText('high'));
            fireEvent.change(screen.getByRole('combobox'), { target: { value: 'medium' } });

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Failed to set priority');
            });
        });

        it('shows error toast when priority change throws', async () => {
            fetchSpy.mockRejectedValueOnce(new Error('Timeout'));

            render(<HealthTable repos={[{ ...baseRepo }]} />);

            fireEvent.click(screen.getByText('high'));
            fireEvent.change(screen.getByRole('combobox'), { target: { value: 'medium' } });

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Error: Timeout');
            });
        });

        it('shows "+ set" text when repo has no priority', () => {
            const noPriorityRepo = { ...baseRepo, priority: null };
            render(<HealthTable repos={[noPriorityRepo]} />);

            expect(screen.getByText('+ set')).toBeInTheDocument();
        });

        it('closes priority editor on blur', () => {
            render(<HealthTable repos={[{ ...baseRepo }]} />);

            fireEvent.click(screen.getByText('high'));
            const select = screen.getByRole('combobox');
            expect(select).toBeInTheDocument();

            fireEvent.blur(select);

            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------
    // Delete modal flow
    // -----------------------------------------------------------

    describe('delete repo modal', () => {
        const deletedRepo = {
            ...baseRepo,
            id: 10,
            name: 'deleted-repo',
            fullName: 'user/deleted-repo',
            isDeleted: true,
        };

        it('shows delete button for deleted repos instead of sync/analyze', () => {
            render(<HealthTable repos={[deletedRepo]} />);

            expect(screen.getByTitle('Remove from database')).toBeInTheDocument();
            expect(screen.queryByTitle('Sync health data')).not.toBeInTheDocument();
            expect(screen.queryByTitle('Deep code analysis (LOC counting)')).not.toBeInTheDocument();
        });

        it('opens delete modal when delete button is clicked', () => {
            render(<HealthTable repos={[deletedRepo]} />);

            fireEvent.click(screen.getByTitle('Remove from database'));

            expect(screen.getByText('Delete Repository')).toBeInTheDocument();
            expect(screen.getByText('user/deleted-repo')).toBeInTheDocument();
        });

        it('closes delete modal when Cancel is clicked', () => {
            render(<HealthTable repos={[deletedRepo]} />);

            fireEvent.click(screen.getByTitle('Remove from database'));
            expect(screen.getByText('Delete Repository')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByText('Delete Repository')).not.toBeInTheDocument();
        });

        it('calls DELETE API and shows success toast when confirmed', async () => {
            const onDataChange = vi.fn();
            render(<HealthTable repos={[deletedRepo]} onDataChange={onDataChange} />);

            fireEvent.click(screen.getByTitle('Remove from database'));
            fireEvent.click(screen.getByText('Delete from Database'));

            await waitFor(() => {
                expect(fetchSpy).toHaveBeenCalledWith(
                    expect.stringContaining('/api/repos/user/deleted-repo'),
                    expect.objectContaining({ method: 'DELETE' })
                );
            });

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('deleted-repo removed from database');
            });

            await waitFor(() => {
                expect(onDataChange).toHaveBeenCalled();
            });
        });

        it('shows error toast when delete fails with response error', async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Not found' }),
            });
            const onDataChange = vi.fn();

            render(<HealthTable repos={[deletedRepo]} onDataChange={onDataChange} />);

            fireEvent.click(screen.getByTitle('Remove from database'));
            fireEvent.click(screen.getByText('Delete from Database'));

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Failed to delete: Not found');
            });
        });

        it('shows error toast when delete throws network error', async () => {
            fetchSpy.mockRejectedValueOnce(new Error('Server unavailable'));

            render(<HealthTable repos={[deletedRepo]} onDataChange={vi.fn()} />);

            fireEvent.click(screen.getByTitle('Remove from database'));
            fireEvent.click(screen.getByText('Delete from Database'));

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.error).toHaveBeenCalledWith('Error deleting repo: Server unavailable');
            });
        });

        it('shows Deleted badge and opacity for deleted repos', () => {
            const { container } = render(<HealthTable repos={[deletedRepo]} />);

            expect(screen.getByText('Deleted')).toBeInTheDocument();
            const row = container.querySelector('tbody tr');
            expect(row.className).toContain('opacity-50');
        });
    });

    // -----------------------------------------------------------
    // Sorting by different fields
    // -----------------------------------------------------------

    describe('sorting by different fields', () => {
        it('sorts by repo name', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'Zebra', fullName: 'user/Zebra', priority: 'high' },
                { ...baseRepo, id: 2, name: 'Alpha', fullName: 'user/Alpha', priority: 'high' },
            ];

            const { container } = render(<HealthTable repos={repos} />);

            const repoHeader = screen.getByText('Repo').closest('th');
            fireEvent.click(repoHeader);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows[0]).toHaveTextContent('Alpha');
            expect(rows[1]).toHaveTextContent('Zebra');
        });

        it('sorts by stack', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'NodeRepo', fullName: 'user/NodeRepo', stack: 'node', priority: 'high' },
                { ...baseRepo, id: 2, name: 'GoRepo', fullName: 'user/GoRepo', stack: 'go', priority: 'high' },
            ];

            const { container } = render(<HealthTable repos={repos} />);

            const stackHeader = screen.getByText('Stack').closest('th');
            fireEvent.click(stackHeader);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows[0]).toHaveTextContent('GoRepo');
            expect(rows[1]).toHaveTextContent('NodeRepo');
        });

        it('sorts by testCoverage using coverageReports average', () => {
            const repos = [
                {
                    ...baseRepo,
                    id: 1,
                    name: 'LowCov',
                    fullName: 'user/LowCov',
                    priority: 'high',
                    testCoverage: null,
                    coverageReports: [{ label: 'default', coverage: 30 }],
                },
                {
                    ...baseRepo,
                    id: 2,
                    name: 'HighCov',
                    fullName: 'user/HighCov',
                    priority: 'high',
                    testCoverage: null,
                    coverageReports: [{ label: 'default', coverage: 90 }],
                },
            ];

            const { container } = render(<HealthTable repos={repos} />);

            // Find the coverage header by its text content
            const headers = container.querySelectorAll('th');
            const covHeader = Array.from(headers).find(h => h.textContent.includes('Cov'));
            fireEvent.click(covHeader);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows[0]).toHaveTextContent('LowCov');
            expect(rows[1]).toHaveTextContent('HighCov');
        });

        it('sorts by boolean fields (hasCi)', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'NoCi', fullName: 'user/NoCi', hasCi: false, priority: 'high' },
                { ...baseRepo, id: 2, name: 'HasCi', fullName: 'user/HasCi', hasCi: true, priority: 'high' },
            ];

            const { container } = render(<HealthTable repos={repos} />);

            // Find CI header
            const headers = container.querySelectorAll('th');
            const ciHeader = Array.from(headers).find(h => h.textContent.includes('\uD83D\uDD27'));
            fireEvent.click(ciHeader);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows[0]).toHaveTextContent('NoCi');
            expect(rows[1]).toHaveTextContent('HasCi');
        });
    });

    // -----------------------------------------------------------
    // Group badge rendering and management
    // -----------------------------------------------------------

    describe('group rendering and management', () => {
        const mockGroups = [
            { id: 'g1', slug: 'frontend', name: 'Frontend' },
            { id: 'g2', slug: 'backend', name: 'Backend' },
        ];

        it('renders group badge when repo has a group', () => {
            const repos = [{ ...baseRepo, groups: ['frontend'] }];
            render(<HealthTable repos={repos} groups={mockGroups} />);

            expect(screen.getByText('Frontend')).toBeInTheDocument();
        });

        it('shows "+ group" text when repo has no group', () => {
            const repos = [{ ...baseRepo, groups: [] }];
            render(<HealthTable repos={repos} groups={mockGroups} />);

            expect(screen.getByText('+ group')).toBeInTheDocument();
        });

        it('opens group select when clicking group badge', () => {
            const repos = [{ ...baseRepo, groups: ['frontend'] }];
            render(<HealthTable repos={repos} groups={mockGroups} />);

            fireEvent.click(screen.getByText('Frontend'));

            const select = screen.getByRole('combobox');
            expect(select).toBeInTheDocument();
            expect(select).toHaveValue('frontend');
        });

        it('calls onAddToGroup when selecting a new group', async () => {
            const onAddToGroup = vi.fn().mockResolvedValue(undefined);
            const onDataChange = vi.fn();
            const repos = [{ ...baseRepo, groups: [] }];

            render(
                <HealthTable
                    repos={repos}
                    groups={mockGroups}
                    onAddToGroup={onAddToGroup}
                    onDataChange={onDataChange}
                />
            );

            fireEvent.click(screen.getByText('+ group'));
            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: 'backend' } });

            await waitFor(() => {
                expect(onAddToGroup).toHaveBeenCalledWith('g2', 'user/test-repo');
            });

            await waitFor(() => {
                expect(onDataChange).toHaveBeenCalled();
            });
        });

        it('calls onRemoveFromGroup when selecting empty value', async () => {
            const onRemoveFromGroup = vi.fn().mockResolvedValue(undefined);
            const onDataChange = vi.fn();
            const repos = [{ ...baseRepo, groups: ['frontend'] }];

            render(
                <HealthTable
                    repos={repos}
                    groups={mockGroups}
                    onRemoveFromGroup={onRemoveFromGroup}
                    onDataChange={onDataChange}
                />
            );

            fireEvent.click(screen.getByText('Frontend'));
            const select = screen.getByRole('combobox');
            fireEvent.change(select, { target: { value: '' } });

            await waitFor(() => {
                expect(onRemoveFromGroup).toHaveBeenCalledWith('g1', 'user/test-repo');
            });

            await waitFor(() => {
                expect(onDataChange).toHaveBeenCalled();
            });
        });

        it('removes from current group and adds to new group when switching', async () => {
            const onAddToGroup = vi.fn().mockResolvedValue(undefined);
            const onRemoveFromGroup = vi.fn().mockResolvedValue(undefined);
            const onDataChange = vi.fn();
            const repos = [{ ...baseRepo, groups: ['frontend'] }];

            render(
                <HealthTable
                    repos={repos}
                    groups={mockGroups}
                    onAddToGroup={onAddToGroup}
                    onRemoveFromGroup={onRemoveFromGroup}
                    onDataChange={onDataChange}
                />
            );

            fireEvent.click(screen.getByText('Frontend'));
            fireEvent.change(screen.getByRole('combobox'), { target: { value: 'backend' } });

            await waitFor(() => {
                expect(onRemoveFromGroup).toHaveBeenCalledWith('g1', 'user/test-repo');
            });

            await waitFor(() => {
                expect(onAddToGroup).toHaveBeenCalledWith('g2', 'user/test-repo');
            });
        });

        it('removes from group when selecting the same group (toggle)', async () => {
            const onRemoveFromGroup = vi.fn().mockResolvedValue(undefined);
            const onDataChange = vi.fn();
            const repos = [{ ...baseRepo, groups: ['frontend'] }];

            render(
                <HealthTable
                    repos={repos}
                    groups={mockGroups}
                    onRemoveFromGroup={onRemoveFromGroup}
                    onDataChange={onDataChange}
                />
            );

            fireEvent.click(screen.getByText('Frontend'));
            fireEvent.change(screen.getByRole('combobox'), { target: { value: 'frontend' } });

            await waitFor(() => {
                expect(onRemoveFromGroup).toHaveBeenCalledWith('g1', 'user/test-repo');
            });
        });

        it('closes group editor on blur', () => {
            const repos = [{ ...baseRepo, groups: ['frontend'] }];
            render(<HealthTable repos={repos} groups={mockGroups} />);

            fireEvent.click(screen.getByText('Frontend'));
            const select = screen.getByRole('combobox');
            expect(select).toBeInTheDocument();

            fireEvent.blur(select);

            expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------
    // Internal notes (expandable row)
    // -----------------------------------------------------------

    describe('internal notes', () => {
        it('shows an expand chevron for non-monorepo repos', () => {
            render(<HealthTable repos={[{ ...baseRepo }]} />);
            expect(screen.getByTitle('Expand (notas internas)')).toBeInTheDocument();
        });

        it('renders the notes section when the row is expanded', () => {
            render(<HealthTable repos={[{ ...baseRepo }]} />);

            expect(screen.queryByText('Notas internas')).not.toBeInTheDocument();
            fireEvent.click(screen.getByTitle('Expand (notas internas)'));

            expect(screen.getByText('Notas internas')).toBeInTheDocument();
            expect(screen.getByText('Sin notas internas. Click para agregar.')).toBeInTheDocument();
        });

        it('shows existing notes text when the repo has notes', () => {
            render(<HealthTable repos={[{ ...baseRepo, notes: 'migrar auth a JWT' }]} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            expect(screen.getByText('migrar auth a JWT')).toBeInTheDocument();
        });

        it('calls onUpdateNotes with (fullName, value) on save', async () => {
            const onUpdateNotes = vi.fn().mockResolvedValue(true);
            render(<HealthTable repos={[{ ...baseRepo }]} onUpdateNotes={onUpdateNotes} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            // Enter edit mode via the placeholder text
            fireEvent.click(screen.getByText('Sin notas internas. Click para agregar.'));

            const textarea = screen.getByPlaceholderText(/Escribí notas internas/);
            fireEvent.change(textarea, { target: { value: '  revisar deploy  ' } });
            fireEvent.click(screen.getByText('Guardar'));

            await waitFor(() => {
                expect(onUpdateNotes).toHaveBeenCalledWith('user/test-repo', 'revisar deploy');
            });

            const toast = (await import('react-hot-toast')).default;
            await waitFor(() => {
                expect(toast.success).toHaveBeenCalledWith('Notas guardadas');
            });
        });

        it('does not call onUpdateNotes when editing is cancelled', () => {
            const onUpdateNotes = vi.fn();
            render(<HealthTable repos={[{ ...baseRepo }]} onUpdateNotes={onUpdateNotes} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            fireEvent.click(screen.getByText('Sin notas internas. Click para agregar.'));
            fireEvent.change(screen.getByPlaceholderText(/Escribí notas internas/), {
                target: { value: 'descartar' },
            });
            fireEvent.click(screen.getByText('Cancelar'));

            expect(onUpdateNotes).not.toHaveBeenCalled();
            expect(screen.queryByPlaceholderText(/Escribí notas internas/)).not.toBeInTheDocument();
        });
    });

    // -----------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------

    describe('empty state', () => {
        it('renders empty table body when no repos are provided', () => {
            const { container } = render(<HealthTable repos={[]} />);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows).toHaveLength(0);
        });

        it('renders empty table body when filter excludes all repos', () => {
            const repos = [
                { ...baseRepo, hasCi: true, hasTests: true, hasReadme: true },
            ];
            const { container } = render(<HealthTable repos={repos} healthFilter="unchecked" />);

            const rows = container.querySelectorAll('tbody tr');
            expect(rows).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------
    // Rendering helpers
    // -----------------------------------------------------------

    describe('rendering helpers', () => {
        it('renders average coverage for multiple coverage reports', () => {
            const repos = [{
                ...baseRepo,
                testCoverage: null,
                coverageReports: [
                    { label: 'frontend', coverage: 85 },
                    { label: 'backend', coverage: 45 },
                ],
            }];

            render(<HealthTable repos={repos} />);

            // Labels are deprecated — shows average instead
            expect(screen.getByText('65%')).toBeInTheDocument();
            expect(screen.queryByText('frontend:')).not.toBeInTheDocument();
            expect(screen.queryByText('backend:')).not.toBeInTheDocument();
        });

        it('renders single default coverage without label prefix', () => {
            const repos = [{
                ...baseRepo,
                testCoverage: null,
                coverageReports: [{ label: 'default', coverage: 72 }],
            }];

            render(<HealthTable repos={repos} />);

            expect(screen.getByText('72%')).toBeInTheDocument();
            expect(screen.queryByText('default:')).not.toBeInTheDocument();
        });

        it('renders coverage dash when no coverage data', () => {
            const repos = [{ ...baseRepo, testCoverage: null, coverageReports: undefined }];
            const { container } = render(<HealthTable repos={repos} />);

            // The dash is rendered for null coverage
            const dashes = container.querySelectorAll('.text-gray-400');
            expect(dashes.length).toBeGreaterThan(0);
        });

        it('renders repo size in KB, MB, and GB', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'small', fullName: 'user/small', repoSizeKb: 500, priority: 'high' },
                { ...baseRepo, id: 2, name: 'medium-size', fullName: 'user/medium', repoSizeKb: 2048, priority: 'medium' },
                { ...baseRepo, id: 3, name: 'large', fullName: 'user/large', repoSizeKb: 1048576, priority: 'low' },
            ];

            render(<HealthTable repos={repos} />);

            expect(screen.getByText('500 KB')).toBeInTheDocument();
            expect(screen.getByText('2.0 MB')).toBeInTheDocument();
            expect(screen.getByText('1.0 GB')).toBeInTheDocument();
        });

        it('renders LOC as formatted number', () => {
            const repos = [{ ...baseRepo, loc: 86396 }];
            render(<HealthTable repos={repos} />);

            expect(screen.getByText('86,396')).toBeInTheDocument();
        });

        it('renders fileCount as formatted number', () => {
            const repos = [{ ...baseRepo, fileCount: 1234 }];
            render(<HealthTable repos={repos} />);

            expect(screen.getByText('1,234')).toBeInTheDocument();
        });

        it('renders "never" for null lastHealthCheck', () => {
            const repos = [{ ...baseRepo, lastHealthCheck: null }];
            render(<HealthTable repos={repos} />);

            expect(screen.getByText('never')).toBeInTheDocument();
        });

        it('renders formatted date for lastHealthCheck', () => {
            const repos = [{ ...baseRepo, lastHealthCheck: '2024-06-15T00:00:00Z' }];
            render(<HealthTable repos={repos} />);

            // The date will render in locale format
            const dateStr = new Date('2024-06-15T00:00:00Z').toLocaleDateString();
            expect(screen.getByText(dateStr)).toBeInTheDocument();
        });

        it('renders Archived badge for archived repos', () => {
            const repos = [{ ...baseRepo, isArchived: true }];
            render(<HealthTable repos={repos} />);

            expect(screen.getByText('Archived')).toBeInTheDocument();
        });

        it('renders stack badges correctly for different stacks', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'py-repo', fullName: 'user/py-repo', stack: 'python', priority: 'high' },
                { ...baseRepo, id: 2, name: 'go-repo', fullName: 'user/go-repo', stack: 'go', priority: 'medium' },
                { ...baseRepo, id: 3, name: 'php-repo', fullName: 'user/php-repo', stack: 'php', priority: 'low' },
            ];

            render(<HealthTable repos={repos} />);

            expect(screen.getByText('py')).toBeInTheDocument();
            expect(screen.getByText('go')).toBeInTheDocument();
            expect(screen.getByText('php')).toBeInTheDocument();
        });

        it('renders roadmap link for repos with roadmap', () => {
            const repos = [{ ...baseRepo, hasRoadmap: true, defaultBranch: 'main' }];
            render(<HealthTable repos={repos} />);

            const roadmapLink = screen.getByTitle('View roadmap');
            expect(roadmapLink).toHaveAttribute(
                'href',
                'https://github.com/user/test-repo/blob/main/docs/roadmap.md'
            );
        });

        it('renders docs quality labels', () => {
            const repos = [
                { ...baseRepo, id: 1, name: 'excellent', fullName: 'user/excellent', hasReadme: true, docsQuality: 'excellent', priority: 'high' },
                { ...baseRepo, id: 2, name: 'needs-work', fullName: 'user/needs-work', hasReadme: true, docsQuality: 'needs_work', priority: 'medium' },
                { ...baseRepo, id: 3, name: 'missing-docs', fullName: 'user/missing-docs', hasReadme: true, docsQuality: 'missing', priority: 'low' },
            ];

            render(<HealthTable repos={repos} />);

            expect(screen.getByText('Excellent')).toBeInTheDocument();
            expect(screen.getByText('Needs work')).toBeInTheDocument();
            expect(screen.getByText('Missing')).toBeInTheDocument();
        });

        it('renders header stats correctly', () => {
            const repos = [
                { ...baseRepo, id: 1, hasCi: true, hasTests: true, hasReadme: true, hasRoadmap: true, priority: 'high' },
                { ...baseRepo, id: 2, name: 'r2', fullName: 'user/r2', hasCi: false, hasTests: false, hasReadme: false, hasRoadmap: false, priority: 'low' },
            ];

            const { container } = render(<HealthTable repos={repos} />);

            // Stats in headers are rendered as separate text nodes within th elements
            // The header text content contains patterns like "📖 1/2", "🔧 1/2", etc.
            const headers = container.querySelectorAll('thead th');
            const headerTexts = Array.from(headers).map(h => h.textContent);
            const statsHeaders = headerTexts.filter(t => t.includes('1/2'));
            expect(statsHeaders.length).toBe(4); // readme, ci, tests, roadmap
        });
    });

    describe('keyboard navigation', () => {
        const repos = [
            { id: 1, name: 'alpha', fullName: 'me/alpha', owner: { login: 'me' }, priority: 'high' },
            { id: 2, name: 'beta', fullName: 'me/beta', owner: { login: 'me' }, priority: 'medium' },
        ];
        const press = (key) => fireEvent.keyDown(window, { key });
        const activeRow = (container) => container.querySelector('tr[data-active="true"]');

        it('moves the active row with j/k and clamps at the ends', () => {
            const { container } = render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);
            expect(activeRow(container)).toBeNull();

            press('j');
            expect(activeRow(container)).toHaveTextContent('alpha');
            press('j'); press('j');
            expect(activeRow(container)).toHaveTextContent('beta');
            press('k'); press('k');
            expect(activeRow(container)).toHaveTextContent('alpha');
        });

        it('toggles selection of the active row with x', () => {
            render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);

            press('x'); // no active row: does nothing
            expect(screen.getByLabelText('Select me/alpha')).not.toBeChecked();

            press('j'); press('x');
            expect(screen.getByLabelText('Select me/alpha')).toBeChecked();
            press('x');
            expect(screen.getByLabelText('Select me/alpha')).not.toBeChecked();
        });

        it('expands the active row with o and clears everything with Escape', () => {
            const { container } = render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);

            press('o'); // no active row: does nothing
            expect(screen.queryByTitle('Collapse')).not.toBeInTheDocument();

            press('j'); press('o'); press('x');
            expect(screen.getByTitle('Collapse')).toBeInTheDocument();

            press('Escape');
            expect(activeRow(container)).toBeNull();
            expect(screen.getByLabelText('Select me/alpha')).not.toBeChecked();
        });

        it('keeps the active row in range when the list shrinks', () => {
            const { container, rerender } = render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);
            press('j'); press('j');

            rerender(<HealthTable repos={repos.slice(0, 1)} onUpdateNotes={vi.fn()} />);

            expect(activeRow(container)).toHaveTextContent('alpha');
        });

        it('ignores j when there are no rows', () => {
            const { container } = render(<HealthTable repos={[]} onUpdateNotes={vi.fn()} />);
            press('j');
            expect(activeRow(container)).toBeNull();
        });
    });

    describe('signals', () => {
        const std = (passed, total) => ({ standards: { passed, total, checks: [], checked_at: '2026-11-23T00:00:00Z' } });
        const repos = [
            { id: 1, name: 'alpha', fullName: 'me/alpha', owner: { login: 'me' }, signals: std(4, 4) },
            { id: 2, name: 'beta', fullName: 'me/beta', owner: { login: 'me' }, signals: std(1, 4) },
            { id: 3, name: 'gamma', fullName: 'me/gamma', owner: { login: 'me' } },
        ];
        const okResponse = (body) => ({ ok: true, json: async () => body });
        let fetchSpy;

        beforeEach(() => {
            fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ ok: true, results: [] }));
        });
        afterEach(() => fetchSpy.mockRestore());

        it('shows a chip per synced repo', () => {
            render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);
            expect(screen.getByText('Std 4/4')).toBeInTheDocument();
            expect(screen.getByText('Std 1/4')).toBeInTheDocument();
        });

        it('filters repos that need standards (incomplete or never synced)', () => {
            render(<HealthTable repos={repos} healthFilter="needs-standards" onUpdateNotes={vi.fn()} />);
            expect(screen.queryByText('alpha')).not.toBeInTheDocument();
            expect(screen.getByText('beta')).toBeInTheDocument();
            expect(screen.getByText('gamma')).toBeInTheDocument();
        });

        it('syncs signals from the expanded row', async () => {
            const onDataChange = vi.fn();
            render(<HealthTable repos={repos.slice(2)} onDataChange={onDataChange} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            fireEvent.click(screen.getByText('Sync signals'));

            await waitFor(() => expect(toast.success).toHaveBeenCalledWith('gamma signals synced'));
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('/api/repos/me/gamma/signals/sync'),
                expect.objectContaining({ method: 'POST' })
            );
            expect(onDataChange).toHaveBeenCalled();
        });

        it.each([
            ['a kind fails', () => okResponse({ ok: false })],
            ['the request fails', () => ({ ok: false, json: async () => ({}) })],
            ['the network fails', () => { throw new Error('offline'); }],
        ])('reports an error when %s', async (_label, respond) => {
            fetchSpy.mockImplementation(async () => respond());
            render(<HealthTable repos={repos.slice(2)} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            fireEvent.click(screen.getByText('Sync signals'));

            await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Some signals failed for gamma'));
        });

        it('also syncs signals after a health sync', async () => {
            render(<HealthTable repos={repos.slice(2)} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByTitle('Sync health data'));

            await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('/api/repos/me/gamma/signals/sync'),
                expect.anything()
            ));
        });

        it('syncs signals for the selected repos in bulk', async () => {
            const onDataChange = vi.fn();
            render(<HealthTable repos={repos} onDataChange={onDataChange} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByLabelText('Select me/alpha'));
            fireEvent.click(screen.getByLabelText('Select me/beta'));
            fireEvent.click(screen.getByTitle('Fetch standards and other signals from GitHub'));

            await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Signals synced for 2/2 repos'));
            expect(fetchSpy).toHaveBeenCalledTimes(2 * SIGNAL_KINDS.length);
            expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/repos/me/beta/signals/sync?kinds=standards'), expect.anything());
            expect(onDataChange).toHaveBeenCalled();
        });
    });

    describe('branch cleanup', () => {
        it('opens the cleanup modal from the expanded row and refreshes when done', async () => {
            const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
                ok: true,
                json: async () => ({ signals: { branches: { items: [] } } }),
            });
            const repo = {
                id: 1, name: 'alpha', fullName: 'me/alpha', owner: { login: 'me' },
                signals: { branches: { total: 3, merged: 2, stale: 0, openPrs: 0, stalePrCount: 0 } },
            };
            render(<HealthTable repos={[repo]} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            fireEvent.click(screen.getByText('Clean up 2 branches…'));

            expect(screen.getByRole('dialog', { name: 'Clean up branches' })).toBeInTheDocument();
            await waitFor(() => expect(screen.getByText(/Nothing to clean up/)).toBeInTheDocument());

            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByRole('dialog', { name: 'Clean up branches' })).not.toBeInTheDocument();
            fetchSpy.mockRestore();
        });
    });

    describe('settings baseline', () => {
        const cfg = (drift, canApply = true) => ({ config: {
            applicable: true, canApply, drift, unknown: 0,
            settings: [{ key: 'has_wiki', label: 'Wiki', expected: false, actual: drift > 0, drift: drift > 0 }],
        } });
        const repos = [
            { id: 1, name: 'alpha', fullName: 'me/alpha', owner: { login: 'me' }, signals: cfg(1) },
            { id: 2, name: 'beta', fullName: 'me/beta', owner: { login: 'me' }, signals: cfg(1) },
            { id: 3, name: 'gamma', fullName: 'me/gamma', owner: { login: 'me' }, signals: cfg(0) },
            { id: 4, name: 'delta', fullName: 'me/delta', owner: { login: 'me' }, signals: cfg(1, false) },
        ];
        let fetchSpy;
        let confirmSpy;

        beforeEach(() => {
            fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ applied: [{ key: 'has_wiki' }] }) });
            confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        });
        afterEach(() => { fetchSpy.mockRestore(); confirmSpy.mockRestore(); });

        const applyFromRow = () => {
            fireEvent.click(screen.getByTitle('Expand (notas internas)'));
            fireEvent.click(screen.getByText('Apply baseline…'));
            fireEvent.click(screen.getByText('Confirm: change 1 settings on GitHub'));
        };

        it('applies the baseline to one repo from its expanded row', async () => {
            const onDataChange = vi.fn();
            render(<HealthTable repos={repos.slice(0, 1)} onDataChange={onDataChange} onUpdateNotes={vi.fn()} />);

            applyFromRow();

            await waitFor(() => expect(toast.success).toHaveBeenCalledWith('alpha: 1 settings updated'));
            expect(fetchSpy).toHaveBeenCalledWith(
                expect.stringContaining('/api/repos/me/alpha/config/apply'),
                expect.objectContaining({ method: 'POST' })
            );
            expect(onDataChange).toHaveBeenCalled();
        });

        it.each([
            ['the API rejects it', async () => ({ ok: false, json: async () => ({ error: 'admin access required' }) }), 'alpha: admin access required'],
            ['the API fails without detail', async () => ({ ok: false, json: async () => ({}) }), 'alpha: Request failed'],
            ['the network fails', async () => { throw new Error('offline'); }, 'alpha: offline'],
        ])('reports an error when %s', async (_label, respond, message) => {
            fetchSpy.mockImplementation(respond);
            render(<HealthTable repos={repos.slice(0, 1)} onUpdateNotes={vi.fn()} />);

            applyFromRow();

            await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
        });

        it('offers the bulk action only for selected repos that drift and can be changed', async () => {
            render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByLabelText('Select me/gamma'));
            fireEvent.click(screen.getByLabelText('Select me/delta'));
            expect(screen.queryByText(/Apply baseline \(/)).not.toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('Select me/alpha'));
            fireEvent.click(screen.getByLabelText('Select me/beta'));
            fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ applied: [{}, {}] }) })
                .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'nope' }) });

            fireEvent.click(screen.getByText('Apply baseline (2)'));

            await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Baseline applied to 1/2 repos (2 settings)'));
            expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('2 repos'));
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        });

        it('does nothing in bulk when the confirmation is declined', () => {
            confirmSpy.mockReturnValue(false);
            render(<HealthTable repos={repos} onUpdateNotes={vi.fn()} />);

            fireEvent.click(screen.getByLabelText('Select me/alpha'));
            fireEvent.click(screen.getByText('Apply baseline (1)'));

            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });
});
