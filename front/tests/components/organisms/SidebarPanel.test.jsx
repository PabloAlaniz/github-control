import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SidebarPanel } from '@/components/organisms/SidebarPanel/SidebarPanel';

// Mock child molecules to keep tests focused on SidebarPanel logic
vi.mock('@/components/molecules/SearchInput', () => ({
    SearchInput: ({ value, onChange, placeholder }) => (
        <input data-testid="search-input" value={value} onChange={onChange} placeholder={placeholder} />
    ),
}));

vi.mock('@/components/molecules/FilterGroup', () => ({
    FilterGroup: ({ label, children }) => <div data-testid={`filter-${label}`}>{children}</div>,
}));

describe('SidebarPanel', () => {
    const defaultProps = {
        activeTab: 'default',
        onTabChange: vi.fn(),
        repoFilters: { search: '', status: 'all', language: 'all', visibility: 'all', groups: { include: [], exclude: [] }, sort: 'updated', hideArchived: true, hidePaused: true },
        onRepoFilterChange: vi.fn(),
        healthFilter: 'all',
        onHealthFilterChange: vi.fn(),
        languages: ['JavaScript', 'Python'],
        uncheckedHealthCount: 0,
        serviceFilters: { search: '', provider: 'all', env: 'all', status: 'all', language: 'all', groups: { include: [], exclude: [] }, sort: 'name' },
        onServiceFilterChange: vi.fn(),
        services: [],
        serviceLanguages: [],
        groups: [{ id: 1, name: 'Frontend', slug: 'frontend', color: '#3b82f6' }],
        repos: [
            { fullName: 'owner/repo1', groups: ['frontend'] },
            { fullName: 'owner/repo2', groups: [] },
        ],
        groupFilter: { include: [], exclude: [] },
        onCycleGroup: vi.fn(),
        onResetGroups: vi.fn(),
        onCreateGroup: vi.fn(),
        onDeleteGroup: vi.fn(),
        onAddToGroup: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders search input with correct placeholder for repos view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="default" />);
        const searchInput = screen.getByTestId('search-input');
        expect(searchInput).toHaveAttribute('placeholder', 'Search repos...');
    });

    it('renders search input with correct placeholder for infrastructure view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="infrastructure" />);
        const searchInput = screen.getByTestId('search-input');
        expect(searchInput).toHaveAttribute('placeholder', 'Search services...');
    });

    it('search input changes call onRepoFilterChange in repos view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="default" />);
        const searchInput = screen.getByTestId('search-input');
        fireEvent.change(searchInput, { target: { value: 'test-query' } });
        expect(defaultProps.onRepoFilterChange).toHaveBeenCalledWith({
            ...defaultProps.repoFilters,
            search: 'test-query',
        });
    });

    it('search input changes call onServiceFilterChange in infrastructure view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="infrastructure" />);
        const searchInput = screen.getByTestId('search-input');
        fireEvent.change(searchInput, { target: { value: 'my-service' } });
        expect(defaultProps.onServiceFilterChange).toHaveBeenCalledWith({
            ...defaultProps.serviceFilters,
            search: 'my-service',
        });
    });

    it('renders repo filter selects in repos view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="default" />);
        expect(screen.getByTestId('filter-Status')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Language')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Visibility')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Health')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Sort')).toBeInTheDocument();
    });

    it('renders service filter selects in infrastructure view', () => {
        render(<SidebarPanel {...defaultProps} activeTab="infrastructure" />);
        expect(screen.getByTestId('filter-Provider')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Environment')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Status')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Language')).toBeInTheDocument();
        expect(screen.getByTestId('filter-Sort')).toBeInTheDocument();
    });

    it('renders "All Repos" button in groups section with correct count', () => {
        render(<SidebarPanel {...defaultProps} />);
        const allReposBtn = screen.getByText('All Repos').closest('button');
        expect(allReposBtn).toBeInTheDocument();
        expect(within(allReposBtn).getByText('2')).toBeInTheDocument();
    });

    it('renders "Ungrouped" button with correct count', () => {
        render(<SidebarPanel {...defaultProps} />);
        const ungroupedBtn = screen.getByText('Ungrouped').closest('button');
        expect(ungroupedBtn).toBeInTheDocument();
        // repo2 has no groups, so ungrouped count is 1
        expect(within(ungroupedBtn).getByText('1')).toBeInTheDocument();
    });

    it('renders custom groups with correct names and repo counts', () => {
        render(<SidebarPanel {...defaultProps} />);
        expect(screen.getByText('Frontend')).toBeInTheDocument();
        // repo1 belongs to 'frontend' group
        const groupBtn = screen.getByText('Frontend').closest('button');
        expect(within(groupBtn).getByText('1')).toBeInTheDocument();
    });

    it('clicking a group cycles it via onCycleGroup; All Repos resets', () => {
        render(<SidebarPanel {...defaultProps} />);

        fireEvent.click(screen.getByText('Frontend'));
        expect(defaultProps.onCycleGroup).toHaveBeenCalledWith('frontend');

        fireEvent.click(screen.getByText('Ungrouped'));
        expect(defaultProps.onCycleGroup).toHaveBeenCalledWith('ungrouped');

        fireEvent.click(screen.getByText('All Repos'));
        expect(defaultProps.onResetGroups).toHaveBeenCalled();
    });

    it('reflects include/exclude state on group buttons', () => {
        render(<SidebarPanel {...defaultProps} groupFilter={{ include: ['frontend'], exclude: ['ungrouped'] }} />);

        const frontendBtn = screen.getByText('Frontend').closest('button');
        expect(frontendBtn.className).toContain('bg-blue-50');

        const ungroupedBtn = screen.getByText('Ungrouped').closest('button');
        expect(ungroupedBtn.className).toContain('bg-red-50');
    });

    it('shows "No custom groups yet" when groups array is empty', () => {
        render(<SidebarPanel {...defaultProps} groups={[]} />);
        expect(screen.getByText('No custom groups yet')).toBeInTheDocument();
    });

    it('CollapsibleSection toggle hides and shows content', () => {
        render(<SidebarPanel {...defaultProps} activeTab="default" />);

        // Filters section is open by default, so filter selects should be visible
        expect(screen.getByTestId('filter-Status')).toBeInTheDocument();

        // Click the "Filters" button to collapse
        const filtersToggle = screen.getByRole('button', { name: /Filters/i });
        fireEvent.click(filtersToggle);

        // Filter selects should be hidden after collapsing
        expect(screen.queryByTestId('filter-Status')).not.toBeInTheDocument();

        // Click again to expand
        fireEvent.click(filtersToggle);
        expect(screen.getByTestId('filter-Status')).toBeInTheDocument();
    });

    it('shows unchecked health badge when count > 0', () => {
        render(<SidebarPanel {...defaultProps} uncheckedHealthCount={5} />);
        expect(screen.getByText('5 unchecked')).toBeInTheDocument();
    });

    it('does not show unchecked health badge when count is 0', () => {
        render(<SidebarPanel {...defaultProps} uncheckedHealthCount={0} />);
        expect(screen.queryByText(/unchecked/)).not.toBeInTheDocument();
    });

    it('create group form: clicking Plus shows form, submitting calls onCreateGroup', () => {
        render(<SidebarPanel {...defaultProps} />);

        // Click the "Create New Group" button (Plus icon)
        const createBtn = screen.getByTitle('Create New Group');
        fireEvent.click(createBtn);

        // Form should now be visible
        const nameInput = screen.getByPlaceholderText('Group name');
        const descInput = screen.getByPlaceholderText('Description (optional)');
        expect(nameInput).toBeInTheDocument();
        expect(descInput).toBeInTheDocument();

        // Fill in the form
        fireEvent.change(nameInput, { target: { value: 'Backend' } });
        fireEvent.change(descInput, { target: { value: 'BE Services' } });

        // Submit the form
        fireEvent.click(screen.getByText('Create Group'));

        expect(defaultProps.onCreateGroup).toHaveBeenCalledWith('Backend', 'BE Services', expect.any(String));
    });
});
