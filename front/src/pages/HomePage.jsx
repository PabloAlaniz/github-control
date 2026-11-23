import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { SidebarPanel } from '../components/organisms/SidebarPanel';
import { StatsOverview } from '../components/organisms/StatsOverview';
import { ServiceStatsOverview } from '../components/organisms/ServiceStatsOverview';
import { TestingStatsOverview } from '../components/organisms/TestingStatsOverview';
import { HealthTable } from '../components/organisms/HealthTable';
import { ServiceTable } from '../components/organisms/ServiceTable';
import { TestingTable } from '../components/organisms/TestingTable';
import { ServiceForm } from '../components/organisms/ServiceForm';
import { TabBar } from '../components/molecules/TabBar';
import { HomeHeader } from '../components/molecules/HomeHeader';
import { SavedViews } from '../components/molecules/SavedViews';
import { CommandPalette } from '../components/organisms/CommandPalette';
import { ErrorState } from '../components/molecules/ErrorState';
import { LayoutGrid, FlaskConical, FileText, Server } from 'lucide-react';

import { useGithubData } from '../hooks';
import { useServices } from '../hooks/useServices';
import { useRepoFilters } from '../hooks/useRepoFilters';
import { useServiceFilters } from '../hooks/useServiceFilters';
import { useServiceActions } from '../hooks/useServiceActions';
import { useFullSync } from '../hooks/useFullSync';
import { useAlertCount } from '../hooks/useAlertCount';

import { useSavedViews } from '../hooks/useSavedViews';
import { useHotkeys } from '../hooks/useHotkeys';
import { buildCommands } from '../lib/commands';
import { cycleGroups, EMPTY_GROUP_FILTER } from '../lib/groupFilter';
import {
    DEFAULT_VIEW_STATE, parseViewState, readViewStateFromUrl,
    serializeViewState, writeViewQueryToUrl,
} from '../lib/viewState';
import { logout } from '../lib/auth';

const TABS = [
    { id: 'default', label: 'Default', icon: LayoutGrid },
    { id: 'testing', label: 'Testing', icon: FlaskConical },
    { id: 'docs', label: 'Docs', icon: FileText, disabled: true, badge: 'Soon' },
    { id: 'infrastructure', label: 'Infra', icon: Server },
];

export function HomePage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(() => readViewStateFromUrl().tab);

    const {
        repos, groups, cacheInfo,
        refreshing, error: reposError,
        refreshData, fetchAll,
        createGroup, deleteGroup, addRepoToGroup, removeRepoFromGroup,
        updateRepoNotes,
    } = useGithubData();

    const {
        repoFilters, setRepoFilters,
        healthFilter, setHealthFilter,
        priorityFilter, setPriorityFilter,
        applyFilters,
        baseRepos, filteredRepos,
        languages, uncheckedHealthCount,
    } = useRepoFilters(repos);

    // The current view (tab + filters) lives in the URL: it can be reloaded, shared or saved.
    const viewQuery = useMemo(
        () => serializeViewState({ tab: activeTab, repoFilters, healthFilter, priorityFilter }),
        [activeTab, repoFilters, healthFilter, priorityFilter]
    );
    useEffect(() => { writeViewQueryToUrl(viewQuery); }, [viewQuery]);

    const { views: savedViews, saveView, deleteView } = useSavedViews();
    const applyViewState = (state) => {
        setActiveTab(state.tab);
        applyFilters(state);
    };

    const servicesHook = useServices();
    const { services, loading: servicesLoading, error: servicesError, fetchServices } = servicesHook;

    const { serviceFilters, setServiceFilters, filteredServices, serviceLanguages } =
        useServiceFilters({ services, repos });

    const {
        showServiceForm, setShowServiceForm,
        editingService, setEditingService,
        checkingSlug, checkingAll,
        handleCreate, handleUpdate, handleDelete,
        handleCheckHealth, handleCheckAllHealth,
    } = useServiceActions(servicesHook);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Full sync (health, metrics, CI, traffic, signals); reload the list when a run finishes.
    // A finished sync re-evaluates the alerts on the server.
    const alerts = useAlertCount();
    const sync = useFullSync(() => { fetchAll(); alerts.refresh(); });

    // Command palette (Cmd/Ctrl+K)
    const [paletteOpen, setPaletteOpen] = useState(false);
    useHotkeys({ 'mod+k': () => setPaletteOpen(open => !open) });
    const handleLogout = () => { logout(); navigate('/login'); };
    const commands = useMemo(() => buildCommands({
        repos, groups, views: savedViews,
        actions: {
            refresh: refreshData,
            syncAll: sync.start,
            resetFilters: () => applyViewState(DEFAULT_VIEW_STATE),
            setTab: setActiveTab,
            navigate,
            applyView: (view) => applyViewState(parseViewState(view.query)),
            filterByGroup: (slug) => {
                setActiveTab(tab => (tab === 'infrastructure' ? 'default' : tab));
                setRepoFilters(prev => ({ ...prev, groups: { include: [slug], exclude: [] } }));
            },
            openExternal: (url) => window.open(url, '_blank', 'noopener'),
            logout: handleLogout,
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [repos, groups, savedViews, refreshData, navigate, sync.start]);

    // Lazy-load services on first switch to infrastructure tab
    const [servicesFetched, setServicesFetched] = useState(false);
    useEffect(() => {
        if (activeTab === 'infrastructure' && !servicesFetched) {
            fetchServices();
            setServicesFetched(true);
        }
    }, [activeTab, servicesFetched, fetchServices]);

    const isRepoTab = activeTab === 'default' || activeTab === 'testing';
    const error = isRepoTab ? reposError : servicesError;
    if (error) {
        return <ErrorState variant="page" message={error} onRetry={isRepoTab ? fetchAll : fetchServices} />;
    }

    return (
        <>
            <DashboardLayout
                sidebar={
                    <SidebarPanel
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        repoFilters={repoFilters}
                        onRepoFilterChange={setRepoFilters}
                        healthFilter={healthFilter}
                        onHealthFilterChange={(e) => setHealthFilter(e.target.value)}
                        priorityFilter={priorityFilter}
                        onPriorityFilterChange={(e) => setPriorityFilter(e.target.value)}
                        languages={languages}
                        uncheckedHealthCount={uncheckedHealthCount}
                        serviceFilters={serviceFilters}
                        onServiceFilterChange={setServiceFilters}
                        services={services}
                        serviceLanguages={serviceLanguages}
                        groups={groups}
                        repos={baseRepos}
                        groupFilter={repoFilters.groups}
                        onCycleGroup={(value) => setRepoFilters(prev => ({ ...prev, groups: cycleGroups(prev.groups, value) }))}
                        onResetGroups={() => setRepoFilters(prev => ({ ...prev, groups: EMPTY_GROUP_FILTER }))}
                        onCreateGroup={createGroup}
                        onDeleteGroup={deleteGroup}
                        onAddToGroup={addRepoToGroup}
                        views={
                            <SavedViews
                                views={savedViews}
                                currentQuery={viewQuery}
                                onApply={(view) => applyViewState(parseViewState(view.query))}
                                onSave={saveView}
                                onDelete={deleteView}
                                onReset={() => applyViewState(DEFAULT_VIEW_STATE)}
                            />
                        }
                    />
                }
                stats={
                    <div className="space-y-4">
                        <HomeHeader
                            activeTab={activeTab}
                            refreshing={refreshing}
                            onRefresh={refreshData}
                            onAddService={() => setShowServiceForm(true)}
                            onActivity={() => navigate('/activity')}
                            onMetrics={() => navigate('/metrics')}
                            onDependencies={() => navigate('/dependencies')}
                            onAlerts={() => navigate('/alerts')}
                            alertCount={alerts.count}
                            onSettings={() => navigate('/settings')}
                            onLogout={handleLogout}
                            onOpenPalette={() => setPaletteOpen(true)}
                            onImportSuccess={fetchAll}
                            sync={sync}
                        />
                        <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />
                        {activeTab === 'default' && <StatsOverview repos={filteredRepos} cacheInfo={cacheInfo} />}
                        {activeTab === 'testing' && <TestingStatsOverview repos={filteredRepos} />}
                        {activeTab === 'infrastructure' && <ServiceStatsOverview services={services} />}
                    </div>
                }
            >
                {activeTab === 'default' && (
                    <HealthTable
                        repos={filteredRepos}
                        groups={groups}
                        healthFilter={healthFilter}
                        priorityFilter={priorityFilter}
                        onDataChange={fetchAll}
                        onAddToGroup={addRepoToGroup}
                        onRemoveFromGroup={removeRepoFromGroup}
                        onUpdateNotes={updateRepoNotes}
                    />
                )}
                {activeTab === 'testing' && (
                    <TestingTable
                        repos={filteredRepos}
                        groups={groups}
                        healthFilter={healthFilter}
                        priorityFilter={priorityFilter}
                        onDataChange={fetchAll}
                        onAddToGroup={addRepoToGroup}
                        onRemoveFromGroup={removeRepoFromGroup}
                    />
                )}
                {activeTab === 'infrastructure' && (
                    <ServiceTable
                        services={filteredServices}
                        loading={servicesLoading && !servicesFetched}
                        onCheckHealth={handleCheckHealth}
                        onCheckAllHealth={handleCheckAllHealth}
                        onEdit={setEditingService}
                        onDelete={handleDelete}
                        checkingSlug={checkingSlug}
                        checkingAll={checkingAll}
                    />
                )}
            </DashboardLayout>

            <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />

            {showServiceForm && (
                <ServiceForm onSubmit={handleCreate} onClose={() => setShowServiceForm(false)} />
            )}
            {editingService && (
                <ServiceForm service={editingService} onSubmit={handleUpdate} onClose={() => setEditingService(null)} />
            )}
        </>
    );
}
