import React, { useState } from 'react';
import { SearchInput } from '../../molecules/SearchInput';
import { FilterGroup } from '../../molecules/FilterGroup';
import { Select } from '../../atoms/Select';
import { Checkbox } from '../../atoms/Checkbox';
import { Button } from '../../atoms/Button';
import { Input } from '../../atoms/Input';
import { Text } from '../../atoms/Text';
import { Card } from '../../atoms/Card';
import { Badge } from '../../atoms/Badge';
import { ColorDot } from '../../atoms/ColorDot';
import { cn } from '../../../lib/utils';
import { cycleGroups, groupState, EMPTY_GROUP_FILTER } from '../../../lib/groupFilter';
import { ChevronDown, ChevronRight, Plus, X, Folder, Layers, Trash2, Check, Ban } from 'lucide-react';

function CollapsibleSection({ title, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div>
            <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider hover:text-gray-600 transition-colors"
                onClick={() => setOpen(!open)}
            >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {title}
            </button>
            {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
        </div>
    );
}

function RepoFilters({ filters, onFilterChange, languages, healthFilter, onHealthFilterChange, priorityFilter, onPriorityFilterChange, uncheckedHealthCount }) {
    function handleChange(key, value) {
        onFilterChange({ ...filters, [key]: value });
    }

    return (
        <>
            <FilterGroup label="Status">
                <Select value={filters.status} onChange={(e) => handleChange('status', e.target.value)}>
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="abandoned">Abandoned</option>
                </Select>
            </FilterGroup>
            <FilterGroup label="Language">
                <Select value={filters.language} onChange={(e) => handleChange('language', e.target.value)}>
                    <option value="all">All Languages</option>
                    {languages.map(lang => (
                        <option key={lang} value={lang}>{lang}</option>
                    ))}
                </Select>
            </FilterGroup>
            <FilterGroup label="Visibility">
                <Select value={filters.visibility} onChange={(e) => handleChange('visibility', e.target.value)}>
                    <option value="all">All Visibility</option>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                </Select>
            </FilterGroup>
            <FilterGroup label="Health">
                <Select value={healthFilter} onChange={onHealthFilterChange}>
                    <option value="all">All Health</option>
                    <option value="unchecked">Unchecked</option>
                    <option value="needs-ci">Needs CI</option>
                    <option value="needs-tests">Needs Tests</option>
                    <option value="needs-readme">Needs README</option>
                    <option value="needs-roadmap">Needs Roadmap</option>
                    <option value="needs-standards">Needs Standards</option>
                    <option value="security-alerts">Security Alerts</option>
                    <option value="unreleased">Unreleased Commits</option>
                    <option value="branch-cleanup">Branch Cleanup</option>
                    <option value="ci-unreliable">Unreliable CI</option>
                    <option value="config-drift">Settings Drift</option>
                    <option value="eol-runtime">EOL Runtime</option>
                    <option value="paused">Paused</option>
                    <option value="deleted">Deleted</option>
                </Select>
            </FilterGroup>
            <FilterGroup label="Priority">
                <Select value={priorityFilter} onChange={onPriorityFilterChange}>
                    <option value="all">All Priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="paused">Paused</option>
                    <option value="none">No Priority</option>
                </Select>
            </FilterGroup>
            <FilterGroup label="Sort">
                <Select value={filters.sort} onChange={(e) => handleChange('sort', e.target.value)}>
                    <option value="updated">Last Updated</option>
                    <option value="name">Name</option>
                    <option value="stars">Stars</option>
                </Select>
            </FilterGroup>
            <div className="space-y-1.5 pt-1">
                <Checkbox
                    label="Hide Archived"
                    checked={filters.hideArchived}
                    onChange={(e) => handleChange('hideArchived', e.target.checked)}
                />
                <Checkbox
                    label="Hide Paused"
                    checked={filters.hidePaused}
                    onChange={(e) => handleChange('hidePaused', e.target.checked)}
                />
                <Checkbox
                    label="Only stale (>30d)"
                    checked={filters.staleOnly}
                    onChange={(e) => handleChange('staleOnly', e.target.checked)}
                />
            </div>
            {uncheckedHealthCount > 0 && (
                <Badge variant="warning" className="whitespace-nowrap">
                    {uncheckedHealthCount} unchecked
                </Badge>
            )}
        </>
    );
}

function ServiceFilters({ filters, onFilterChange, providers, envs, languages }) {
    function handleChange(key, value) {
        onFilterChange({ ...filters, [key]: value });
    }

    return (
        <>
            <FilterGroup label="Provider">
                <Select value={filters.provider} onChange={(e) => handleChange('provider', e.target.value)}>
                    <option value="all">All Providers</option>
                    {providers.map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                </Select>
            </FilterGroup>
            <FilterGroup label="Environment">
                <Select value={filters.env} onChange={(e) => handleChange('env', e.target.value)}>
                    <option value="all">All Envs</option>
                    {envs.map(e => (
                        <option key={e} value={e}>{e}</option>
                    ))}
                </Select>
            </FilterGroup>
            <FilterGroup label="Status">
                <Select value={filters.status} onChange={(e) => handleChange('status', e.target.value)}>
                    <option value="all">All Status</option>
                    <option value="healthy">Healthy</option>
                    <option value="degraded">Degraded</option>
                    <option value="down">Down</option>
                    <option value="unknown">Unknown</option>
                </Select>
            </FilterGroup>
            <FilterGroup label="Language">
                <Select value={filters.language} onChange={(e) => handleChange('language', e.target.value)}>
                    <option value="all">All Languages</option>
                    {languages.map(lang => (
                        <option key={lang} value={lang}>{lang}</option>
                    ))}
                </Select>
            </FilterGroup>
            <FilterGroup label="Sort">
                <Select value={filters.sort} onChange={(e) => handleChange('sort', e.target.value)}>
                    <option value="name">Name</option>
                    <option value="provider">Provider</option>
                    <option value="status">Status</option>
                    <option value="responseMs">Response Time</option>
                </Select>
            </FilterGroup>
        </>
    );
}

function GroupsSection({
    groups,
    repos,
    groupFilter = EMPTY_GROUP_FILTER,
    onCycleGroup,
    onResetGroups,
    onCreateGroup,
    onDeleteGroup,
    onAddToGroup,
    itemLabel = 'Repos',
}) {
    const allActive = groupFilter.include.length === 0 && groupFilter.exclude.length === 0;
    const stateOf = (value) => groupState(groupFilter, value);
    const stateClasses = {
        include: 'bg-blue-50 border-blue-100 text-blue-700 shadow-sm',
        exclude: 'bg-red-50 border-red-100 text-red-700 shadow-sm',
        neutral: '',
    };
    const StateIcon = ({ state, size = 12 }) =>
        state === 'include' ? <Check size={size} className="text-blue-600" />
        : state === 'exclude' ? <Ban size={size} className="text-red-600" />
        : null;
    const [showForm, setShowForm] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [newGroupColor, setNewGroupColor] = useState('#6366f1');
    const [dragOverGroup, setDragOverGroup] = useState(null);

    const colors = [
        '#ef4444', '#f97316', '#eab308', '#22c55e',
        '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
    ];

    function handleDragOver(e, groupId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOverGroup(groupId);
    }

    function handleDragLeave() {
        setDragOverGroup(null);
    }

    function handleDrop(e, groupId) {
        e.preventDefault();
        const repoFullName = e.dataTransfer.getData('text/plain');
        if (repoFullName && onAddToGroup) {
            onAddToGroup(groupId, repoFullName);
        }
        setDragOverGroup(null);
    }

    function handleSubmit(e) {
        e.preventDefault();
        if (newGroupName.trim()) {
            onCreateGroup(newGroupName.trim(), newGroupDesc.trim(), newGroupColor);
            setNewGroupName('');
            setNewGroupDesc('');
            setShowForm(false);
        }
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between px-3 py-1">
                <Text variant="small" className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">
                    Groups
                </Text>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowForm(!showForm)}
                    className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                    title="Create New Group"
                >
                    {showForm ? <X size={12} /> : <Plus size={12} />}
                </Button>
            </div>

            {showForm && (
                <form className="p-3 mx-2 mb-2 bg-gray-50 rounded-lg border border-gray-100 space-y-2 animate-in slide-in-from-top-2" onSubmit={handleSubmit}>
                    <Input
                        type="text"
                        placeholder="Group name"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        autoFocus
                        className="bg-white"
                    />
                    <Input
                        type="text"
                        placeholder="Description (optional)"
                        value={newGroupDesc}
                        onChange={(e) => setNewGroupDesc(e.target.value)}
                        className="bg-white"
                    />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {colors.map(color => (
                            <Button
                                key={color}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className={cn(
                                    "w-5 h-5 rounded-full transition-transform hover:scale-110 ring-2 ring-offset-1 ring-transparent focus:ring-gray-400 p-0",
                                    color === newGroupColor && "ring-gray-400 scale-110"
                                )}
                                style={{ backgroundColor: color }}
                                onClick={() => setNewGroupColor(color)}
                            />
                        ))}
                    </div>
                    <Button type="submit" size="sm" className="w-full mt-2">Create Group</Button>
                </form>
            )}

            <button
                className={cn(
                    "w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                    allActive && "bg-blue-50 border-blue-100 text-blue-700 shadow-sm"
                )}
                onClick={onResetGroups}
            >
                <div className="flex items-center gap-3">
                    <div className="p-1 rounded-md bg-gray-100 text-gray-500">
                        <Layers size={14} />
                    </div>
                    <span className="font-medium text-sm">All {itemLabel}</span>
                </div>
                <span className="text-xs font-semibold bg-gray-200/50 px-2 py-0.5 rounded-full text-gray-600">
                    {repos.length}
                </span>
            </button>

            {(() => {
                const ungroupedState = stateOf('ungrouped');
                return (
                    <button
                        className={cn(
                            "w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                            stateClasses[ungroupedState]
                        )}
                        onClick={() => onCycleGroup('ungrouped')}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className="p-1 rounded-md bg-gray-100 text-gray-500">
                                <Folder size={14} />
                            </div>
                            <span className={cn("font-medium text-sm", ungroupedState === 'exclude' && "line-through")}>Ungrouped</span>
                            <StateIcon state={ungroupedState} />
                        </div>
                        <span className="text-xs font-semibold bg-gray-200/50 px-2 py-0.5 rounded-full text-gray-600">
                            {repos.filter(r => !r.groups || r.groups.length === 0).length}
                        </span>
                    </button>
                );
            })()}

            <div className="h-px bg-gray-100 my-1 mx-2" />

            <div className="space-y-0.5">
                {groups.map(group => {
                    const repoCount = repos.filter(r => r.groups?.includes(group.slug)).length;
                    const state = stateOf(group.slug);
                    const isActive = state !== 'neutral';
                    const isDragOver = dragOverGroup === group.id;

                    return (
                        <div
                            key={group.id}
                            className="relative group/item"
                            onDragOver={(e) => handleDragOver(e, group.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, group.id)}
                        >
                            <button
                                className={cn(
                                    "w-full flex items-center justify-between p-2 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                                    stateClasses[state],
                                    isDragOver && "bg-blue-50 border-blue-300 ring-2 ring-blue-200 z-10 scale-[1.02]"
                                )}
                                onClick={() => onCycleGroup(group.slug)}
                            >
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <ColorDot color={group.color} size="md" />
                                    <span className={cn("font-medium text-sm truncate", state === 'exclude' && "line-through")}>{group.name}</span>
                                    <StateIcon state={state} />
                                </div>
                                <span className={cn(
                                    "text-xs font-semibold px-2 py-0.5 rounded-full text-gray-600",
                                    isActive ? "bg-white/50" : "bg-gray-100"
                                )}>
                                    {repoCount}
                                </span>
                            </button>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-10 top-1/2 -translate-y-1/2 p-1 h-auto w-auto text-gray-400 hover:text-red-500 rounded opacity-0 group-hover/item:opacity-100 transition-opacity"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm('Are you sure you want to delete this group?')) {
                                        onDeleteGroup(group.id);
                                    }
                                }}
                                title="Delete group"
                            >
                                <Trash2 size={14} />
                            </Button>
                        </div>
                    );
                })}
                {groups.length === 0 && (
                    <div className="px-3 py-3 text-center">
                        <Text variant="small" className="text-gray-400 italic">No custom groups yet</Text>
                    </div>
                )}
            </div>
        </div>
    );
}

export function SidebarPanel({
    activeTab,
    onTabChange,
    // Repo filter props
    repoFilters,
    onRepoFilterChange,
    healthFilter,
    onHealthFilterChange,
    priorityFilter,
    onPriorityFilterChange,
    languages,
    uncheckedHealthCount,
    // Service filter props
    serviceFilters,
    onServiceFilterChange,
    services,
    serviceLanguages,
    // Group props
    groups,
    repos,
    groupFilter,
    onCycleGroup,
    onResetGroups,
    onCreateGroup,
    onDeleteGroup,
    onAddToGroup,
    // Optional slot for saved views (repo tabs only)
    views,
}) {
    const isRepoTab = activeTab === 'default' || activeTab === 'testing';
    const isServiceTab = activeTab === 'infrastructure';

    const providers = [...new Set((services || []).map(s => s.provider))].sort();
    const envs = [...new Set((services || []).map(s => s.env))].sort();

    // Map services to items with groups (for GroupsSection counts in services view)
    const repoMap = new Map((repos || []).map(r => [r.fullName, r]));
    const serviceItems = (services || []).map(s => {
        const linkedRepo = repoMap.get(s.sourceRepoFullName);
        return { groups: linkedRepo?.groups || [] };
    });

    const searchValue = isRepoTab ? repoFilters.search : serviceFilters.search;
    const onSearchChange = (e) => {
        if (isRepoTab) {
            onRepoFilterChange({ ...repoFilters, search: e.target.value });
        } else {
            onServiceFilterChange({ ...serviceFilters, search: e.target.value });
        }
    };

    return (
        <Card className="h-full flex flex-col bg-white border-r border-gray-200 rounded-none h-[calc(100vh-64px)] overflow-hidden">
            {/* Search - sticky top */}
            <div className="p-3 border-b border-gray-100 bg-white sticky top-0 z-10">
                <SearchInput
                    placeholder={isRepoTab ? 'Search repos...' : 'Search services...'}
                    value={searchValue}
                    onChange={onSearchChange}
                    className="w-full"
                />
                {isRepoTab && (
                    <a
                        href={`/search${searchValue?.trim() ? `?q=${encodeURIComponent(searchValue.trim())}` : ''}`}
                        className="mt-2 inline-block text-xs text-blue-600 hover:underline"
                    >
                        {searchValue?.trim() ? `Search “${searchValue.trim()}” in the code of all repos` : 'Search the code of all repos'}
                    </a>
                )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Saved views */}
                {isRepoTab && views && (
                    <>
                        <div className="pt-2">{views}</div>
                        <div className="h-px bg-gray-100 mx-3" />
                    </>
                )}

                {/* Filters */}
                <CollapsibleSection title="Filters" defaultOpen={true}>
                    {isRepoTab ? (
                        <RepoFilters
                            filters={repoFilters}
                            onFilterChange={onRepoFilterChange}
                            languages={languages}
                            healthFilter={healthFilter}
                            onHealthFilterChange={onHealthFilterChange}
                            priorityFilter={priorityFilter}
                            onPriorityFilterChange={onPriorityFilterChange}
                            uncheckedHealthCount={uncheckedHealthCount}
                        />
                    ) : isServiceTab ? (
                        <ServiceFilters
                            filters={serviceFilters}
                            onFilterChange={onServiceFilterChange}
                            providers={providers}
                            envs={envs}
                            languages={serviceLanguages || []}
                        />
                    ) : null}
                </CollapsibleSection>

                {/* Groups */}
                <>
                    <div className="h-px bg-gray-100 mx-3" />
                    {isRepoTab ? (
                        <GroupsSection
                            groups={groups}
                            repos={repos}
                            groupFilter={groupFilter}
                            onCycleGroup={onCycleGroup}
                            onResetGroups={onResetGroups}
                            onCreateGroup={onCreateGroup}
                            onDeleteGroup={onDeleteGroup}
                            onAddToGroup={onAddToGroup}
                        />
                    ) : isServiceTab ? (
                        <GroupsSection
                            groups={groups}
                            repos={serviceItems}
                            groupFilter={serviceFilters.groups}
                            onCycleGroup={(value) => onServiceFilterChange({ ...serviceFilters, groups: cycleGroups(serviceFilters.groups, value) })}
                            onResetGroups={() => onServiceFilterChange({ ...serviceFilters, groups: EMPTY_GROUP_FILTER })}
                            onCreateGroup={onCreateGroup}
                            onDeleteGroup={onDeleteGroup}
                            itemLabel="Services"
                        />
                    ) : null}
                </>
            </div>
        </Card>
    );
}
