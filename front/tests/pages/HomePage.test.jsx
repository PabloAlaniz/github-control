import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomePage } from '@/pages/HomePage';
import * as router from 'react-router-dom';
import * as hooks from '@/hooks';
import * as servicesHook from '@/hooks/useServices';
import * as savedViewsHook from '@/hooks/useSavedViews';

// Mock dependencies
vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
}));

vi.mock('@/hooks', () => ({
    useGithubData: vi.fn(),
}));

vi.mock('@/hooks/useServices', () => ({
    useServices: vi.fn(),
}));

vi.mock('@/hooks/useSavedViews', () => ({
    useSavedViews: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
    default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
    logout: vi.fn(),
}));

// Mock Child Components
vi.mock('@/components/templates/DashboardLayout', () => ({
    DashboardLayout: ({ children, sidebar, stats }) => (
        <div data-testid="layout">
            <div data-testid="sidebar">{sidebar}</div>
            <div data-testid="stats">{stats}</div>
            <div data-testid="content">{children}</div>
        </div>
    )
}));

vi.mock('@/components/organisms/SidebarPanel', () => ({
    SidebarPanel: ({ activeTab, onTabChange, repoFilters, onRepoFilterChange, views }) => (
        <div data-testid="sidebar-panel">
            {views}
            <button data-testid="switch-default" onClick={() => onTabChange('default')}>Default</button>
            <button data-testid="switch-infrastructure" onClick={() => onTabChange('infrastructure')}>Infra</button>
            <input
                data-testid="search-input"
                value={repoFilters.search}
                onChange={e => onRepoFilterChange({ ...repoFilters, search: e.target.value })}
            />
            <select
                data-testid="status-select"
                value={repoFilters.status}
                onChange={e => onRepoFilterChange({ ...repoFilters, status: e.target.value })}
            >
                <option value="all">All</option>
                <option value="active">Active</option>
            </select>
        </div>
    )
}));

vi.mock('@/components/organisms/HealthTable', () => ({
    HealthTable: ({ repos }) => (
        <div data-testid="health-table">
            {repos.map(r => <div key={r.id} data-testid="repo-item">{r.name}</div>)}
        </div>
    )
}));

vi.mock('@/components/organisms/ServiceTable', () => ({
    ServiceTable: ({ services }) => (
        <div data-testid="service-table">
            {services.map(s => <div key={s.slug} data-testid="service-item">{s.name}</div>)}
        </div>
    )
}));

vi.mock('@/components/organisms/ServiceForm', () => ({
    ServiceForm: () => <div data-testid="service-form">Form</div>
}));

vi.mock('@/components/organisms/StatsOverview', () => ({ StatsOverview: () => <div data-testid="stats-overview">Stats</div> }));
vi.mock('@/components/organisms/ServiceStatsOverview', () => ({ ServiceStatsOverview: () => <div data-testid="service-stats">ServiceStats</div> }));
vi.mock('@/components/organisms/TestingStatsOverview', () => ({ TestingStatsOverview: () => <div data-testid="testing-stats">TestingStats</div> }));
vi.mock('@/components/organisms/TestingTable', () => ({
    TestingTable: ({ repos }) => (
        <div data-testid="testing-table">
            {repos.map(r => <div key={r.id} data-testid="testing-repo-item">{r.name}</div>)}
        </div>
    )
}));
vi.mock('@/components/molecules/TabBar', () => ({
    TabBar: ({ tabs, activeTab, onTabChange }) => (
        <div data-testid="tab-bar">
            {tabs.map(t => (
                <button key={t.id} data-testid={`tab-${t.id}`} onClick={() => !t.disabled && onTabChange(t.id)}>
                    {t.label}
                </button>
            ))}
        </div>
    )
}));

describe('HomePage', () => {
    const mockNavigate = vi.fn();
    const mockUseGithubData = {
        repos: [
            { id: 1, name: 'Repo1', fullName: 'me/Repo1', activityStatus: 'active', language: 'js', isPrivate: false, isArchived: false, priority: 'high', groups: [], pushedAt: '2023-01-01', hasCi: true, hasTests: true, hasReadme: true },
            { id: 2, name: 'Repo2', fullName: 'me/Repo2', activityStatus: 'inactive', language: 'py', isPrivate: true, isArchived: false, priority: null, groups: ['g1'], pushedAt: '2022-01-01', hasCi: null, hasTests: null, hasReadme: null },
        ],
        groups: [{ id: 'g1', name: 'Group1', slug: 'g1' }],
        cacheInfo: {},
        loading: false,
        refreshing: false,
        error: null,
        fetchAll: vi.fn(),
        refreshData: vi.fn(),
        addRepoToGroup: vi.fn(),
        removeRepoFromGroup: vi.fn(),
        createGroup: vi.fn(),
        deleteGroup: vi.fn(),
    };

    const mockUseServices = {
        services: [],
        loading: false,
        error: null,
        fetchServices: vi.fn(),
        createService: vi.fn(),
        updateService: vi.fn(),
        deleteService: vi.fn(),
        checkHealth: vi.fn(),
        checkAllHealth: vi.fn(),
    };

    const mockUseSavedViews = {
        views: [{ id: 1, name: 'Solo activos', query: 'status=active' }],
        saveView: vi.fn().mockResolvedValue(true),
        deleteView: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Filters are reflected in the URL: start each test from the default view.
        window.history.replaceState(null, '', '/');
        router.useNavigate.mockReturnValue(mockNavigate);
        hooks.useGithubData.mockReturnValue(mockUseGithubData);
        servicesHook.useServices.mockReturnValue(mockUseServices);
        savedViewsHook.useSavedViews.mockReturnValue(mockUseSavedViews);
    });

    it('renders main layout with repos view by default', () => {
        render(<HomePage />);
        expect(screen.getByTestId('layout')).toBeInTheDocument();
        expect(screen.getByTestId('health-table')).toBeInTheDocument();
        expect(screen.getByTestId('sidebar-panel')).toBeInTheDocument();
        expect(screen.getByTestId('stats-overview')).toBeInTheDocument();
    });

    it('filters repositories by search', () => {
        render(<HomePage />);

        expect(screen.getAllByTestId('repo-item')).toHaveLength(2);

        const input = screen.getByTestId('search-input');
        fireEvent.change(input, { target: { value: 'Repo1' } });

        const items = screen.getAllByTestId('repo-item');
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent('Repo1');
    });

    it('filters repositories by status', () => {
        render(<HomePage />);

        const select = screen.getByTestId('status-select');
        fireEvent.change(select, { target: { value: 'active' } });

        const items = screen.getAllByTestId('repo-item');
        expect(items).toHaveLength(1);
        expect(items[0]).toHaveTextContent('Repo1');
    });

    it('switches to infrastructure tab', () => {
        render(<HomePage />);

        fireEvent.click(screen.getByTestId('switch-infrastructure'));

        expect(screen.getByTestId('service-table')).toBeInTheDocument();
        expect(screen.getByTestId('service-stats')).toBeInTheDocument();
        expect(screen.queryByTestId('health-table')).not.toBeInTheDocument();
    });

    it('switches to testing tab', () => {
        render(<HomePage />);

        fireEvent.click(screen.getByTestId('tab-testing'));

        expect(screen.getByTestId('testing-table')).toBeInTheDocument();
        expect(screen.getByTestId('testing-stats')).toBeInTheDocument();
        expect(screen.queryByTestId('health-table')).not.toBeInTheDocument();
    });

    it('leaves getting around the app to the navigation', () => {
        render(<HomePage />);
        // The header keeps the dashboard's own actions only.
        expect(screen.queryByText('Activity')).not.toBeInTheDocument();
        expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    });

    describe('view state in the URL', () => {
        it('reflects filters and tab in the query string', () => {
            render(<HomePage />);

            fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'Repo1' } });
            fireEvent.click(screen.getByTestId('tab-testing'));

            expect(window.location.search).toBe('?tab=testing&q=Repo1');
        });

        it('keeps the URL clean on the default view', () => {
            render(<HomePage />);

            expect(window.location.search).toBe('');
        });

        it('restores filters and tab from the URL on load', () => {
            window.history.replaceState(null, '', '/?tab=testing&status=active');

            render(<HomePage />);

            const items = screen.getAllByTestId('testing-repo-item');
            expect(items).toHaveLength(1);
            expect(items[0]).toHaveTextContent('Repo1');
        });
    });

    describe('saved views', () => {
        it('applies a saved view when clicked', () => {
            render(<HomePage />);

            fireEvent.click(screen.getByText('Solo activos'));

            expect(screen.getAllByTestId('repo-item')).toHaveLength(1);
            expect(window.location.search).toBe('?status=active');
        });

        it('saves the current filters under a name', async () => {
            render(<HomePage />);
            fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'Repo2' } });

            fireEvent.click(screen.getByTitle('Save current view'));
            fireEvent.change(screen.getByPlaceholderText('View name'), { target: { value: 'Busqueda' } });
            fireEvent.click(screen.getByText('Save current filters'));

            expect(mockUseSavedViews.saveView).toHaveBeenCalledWith('Busqueda', 'q=Repo2');
        });

        it('resets to the default view', () => {
            window.history.replaceState(null, '', '/?status=active');
            render(<HomePage />);
            expect(screen.getAllByTestId('repo-item')).toHaveLength(1);

            fireEvent.click(screen.getByTitle('Reset filters'));

            expect(screen.getAllByTestId('repo-item')).toHaveLength(2);
            expect(window.location.search).toBe('');
        });
    });

    describe('command palette', () => {
        const openPalette = () => fireEvent.keyDown(window, { key: 'k', metaKey: true });

        it('opens with Cmd+K and from the header button, and toggles closed', () => {
            render(<HomePage />);
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            openPalette();
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            openPalette();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

            fireEvent.click(screen.getByLabelText('Open command palette'));
            expect(screen.getByRole('dialog')).toBeInTheDocument();
        });

        const runCommand = (text) => {
            openPalette();
            fireEvent.change(screen.getByPlaceholderText(/Jump to a repo/), { target: { value: text } });
            fireEvent.keyDown(screen.getByPlaceholderText(/Jump to a repo/), { key: 'Enter' });
        };

        it('jumps to a repo', () => {
            render(<HomePage />);
            runCommand('Repo2');
            expect(mockNavigate).toHaveBeenCalledWith('/metrics/me/Repo2');
        });

        it('filters by group, applies views, switches tabs and resets', () => {
            render(<HomePage />);

            runCommand('Group1');
            expect(window.location.search).toBe('?groups=g1');

            runCommand('Solo activos');
            expect(window.location.search).toBe('?status=active');

            runCommand('Testing tab');
            expect(screen.getByTestId('testing-table')).toBeInTheDocument();

            runCommand('Reset filters');
            expect(window.location.search).toBe('');
        });

        it('runs refresh, navigation and logout', () => {
            render(<HomePage />);

            runCommand('Refresh data');
            expect(mockUseGithubData.refreshData).toHaveBeenCalled();

            runCommand('Activity');
            expect(mockNavigate).toHaveBeenCalledWith('/activity');

            runCommand('Log out');
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });

        it('filtering by group from the Infra tab goes back to repos', () => {
            window.history.replaceState(null, '', '/?tab=infrastructure');
            render(<HomePage />);

            runCommand('Group1');

            expect(screen.getByTestId('health-table')).toBeInTheDocument();
        });

        it('opens a repo on GitHub with Shift+Enter', () => {
            const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
            render(<HomePage />);

            openPalette();
            fireEvent.change(screen.getByPlaceholderText(/Jump to a repo/), { target: { value: 'Repo1' } });
            fireEvent.keyDown(screen.getByPlaceholderText(/Jump to a repo/), { key: 'Enter', shiftKey: true });

            expect(openSpy).toHaveBeenCalledWith('https://github.com/me/Repo1', '_blank', 'noopener');
            openSpy.mockRestore();
        });
    });
});
