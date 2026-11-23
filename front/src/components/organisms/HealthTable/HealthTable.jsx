import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Card } from '../../atoms/Card';
import { Badge } from '../../atoms/Badge';
import { Text } from '../../atoms/Text';
import { Button } from '../../atoms/Button';
import { ExternalLink } from '../../atoms/ExternalLink';
import { cn } from '../../../lib/utils';
import { ArrowUp, ArrowDown, CheckCircle, XCircle, HelpCircle, RefreshCw, Trash2, ChevronRight, ChevronDown, TrendingUp } from 'lucide-react';
import { getLanguageColor, daysSinceLastCommit, isStale } from '../../../lib/formatters';
import { apiFetch } from '../../../lib/api';
import { DeleteRepoModal } from '../DeleteRepoModal/DeleteRepoModal';
import { HealthScoreBadge } from '../../molecules/HealthScoreBadge';
import { CiStatusBadge } from '../../atoms/CiStatusBadge';
import { TrendIndicator } from '../../atoms/TrendIndicator';
import { Checkbox } from '../../atoms/Checkbox';
import { BulkActionBar } from '../BulkActionBar';
import { AiSummaryModal } from '../AiSummaryModal';
import { RepoNotes } from '../../molecules/RepoNotes';
import { BranchCleanupModal } from '../BranchCleanupModal';
import { RepoSignals, SignalChips } from '../../molecules/RepoSignals';
import { matchesSignalFilter, SIGNAL_KINDS } from '../../../lib/signals';
import { Sparkles } from 'lucide-react';
import { useHotkeys } from '../../../hooks/useHotkeys';

export function HealthTable({ repos, groups = [], healthFilter = 'all', priorityFilter = 'all', onDataChange, onAddToGroup, onRemoveFromGroup, onUpdateNotes }) {
    const [sortField, setSortField] = useState('priority');
    const [sortDir, setSortDir] = useState('desc');
    const [editingPriority, setEditingPriority] = useState(null);
    const [editingGroup, setEditingGroup] = useState(null);
    const [syncingRepos, setSyncingRepos] = useState(new Set());
    const [deletingRepo, setDeletingRepo] = useState(null);
    const [expandedRepos, setExpandedRepos] = useState(new Set());
    const [syncingApps, setSyncingApps] = useState(new Set());
    const [selectedRepos, setSelectedRepos] = useState(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const [summaryRepo, setSummaryRepo] = useState(null);
    const [cleanupRepo, setCleanupRepo] = useState(null);
    const navigate = useNavigate();
    // Row with keyboard focus (j/k). -1 = none.
    const [activeRow, setActiveRow] = useState(-1);
    const tbodyRef = useRef(null);

    const toggleSelectRepo = (fullName) => {
        setSelectedRepos(prev => {
            const next = new Set(prev);
            if (next.has(fullName)) next.delete(fullName);
            else next.add(fullName);
            return next;
        });
    };

    const clearSelection = () => setSelectedRepos(new Set());

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const aggregateBool = (repo, field) => {
        if (!repo.isMonorepo || !repo.apps?.length) return repo[field];
        const values = repo.apps.map(a => a[field]);
        if (values.some(v => v === false)) return false;
        if (values.every(v => v === true)) return true;
        return null;
    };

    const DOCS_QUALITY_ORDER = ['missing', 'needs_work', 'good', 'excellent'];
    const aggregateDocsQuality = (repo) => {
        if (!repo.isMonorepo || !repo.apps?.length) return repo.docsQuality;
        const qualities = repo.apps.map(a => a.docsQuality).filter(Boolean);
        if (qualities.length === 0) return repo.docsQuality;
        return qualities.reduce((worst, q) =>
            DOCS_QUALITY_ORDER.indexOf(q) < DOCS_QUALITY_ORDER.indexOf(worst) ? q : worst
        );
    };

    const sortedRepos = useMemo(() => {
        let filtered = [...repos];

        switch (healthFilter) {
            case 'needs-ci':
                filtered = filtered.filter(r => {
                    const val = aggregateBool(r, 'hasCi');
                    return val === false || val === null;
                });
                break;
            case 'needs-tests':
                filtered = filtered.filter(r => {
                    const val = aggregateBool(r, 'hasTests');
                    return val === false || val === null;
                });
                break;
            case 'needs-readme':
                filtered = filtered.filter(r => {
                    const val = aggregateBool(r, 'hasReadme');
                    return val === false || val === null;
                });
                break;
            case 'needs-roadmap':
                filtered = filtered.filter(r => r.hasRoadmap === false || r.hasRoadmap === null);
                break;
            case 'unchecked':
                filtered = filtered.filter(r => r.hasCi === null && r.hasTests === null && r.hasReadme === null);
                break;
            case 'deleted':
                filtered = filtered.filter(r => r.isDeleted === true);
                break;
            case 'paused':
                filtered = filtered.filter(r => r.priority === 'paused');
                break;
            default:
                // Signal-based filters (needs-standards, ...)
                if (matchesSignalFilter({}, healthFilter) !== null) {
                    filtered = filtered.filter(r => matchesSignalFilter(r, healthFilter));
                }
        }

        // Priority filter
        if (priorityFilter !== 'all') {
            if (priorityFilter === 'none') {
                filtered = filtered.filter(r => !r.priority);
            } else {
                filtered = filtered.filter(r => r.priority === priorityFilter);
            }
        }

        const avgCoverage = (repo) => {
            if (repo.apps?.length > 0) {
                const appsWithCov = repo.apps.filter(a => a.coverageValue != null);
                if (appsWithCov.length > 0) {
                    return appsWithCov.reduce((s, a) => s + a.coverageValue, 0) / appsWithCov.length;
                }
                return -1;
            }
            const reps = repo.coverageReports;
            if (reps && reps.length > 0) {
                return reps.reduce((sum, r) => sum + r.coverage, 0) / reps.length;
            }
            return repo.testCoverage ?? -1;
        };

        filtered.sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];

            if (sortField === 'testCoverage') {
                aVal = avgCoverage(a);
                bVal = avgCoverage(b);
            }

            if (['hasReadme', 'hasCi', 'hasTests'].includes(sortField)) {
                aVal = aggregateBool(a, sortField);
                bVal = aggregateBool(b, sortField);
            }

            if (sortField === 'priority') {
                const priorityOrder = { high: 4, medium: 3, low: 2, paused: 1 };
                aVal = priorityOrder[aVal] || 0;
                bVal = priorityOrder[bVal] || 0;
            }

            if (sortField === 'healthScore') {
                aVal = a.healthScore?.score ?? -1;
                bVal = b.healthScore?.score ?? -1;
            }

            if (aVal === null || aVal === undefined) aVal = '';
            if (bVal === null || bVal === undefined) bVal = '';

            if (typeof aVal === 'boolean') aVal = aVal ? 1 : 0;
            if (typeof bVal === 'boolean') bVal = bVal ? 1 : 0;

            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });

        return filtered;
    }, [repos, healthFilter, priorityFilter, sortField, sortDir]);

    // Keyboard shortcuts: j/k move the focus, x selects, o expands, esc clears.
    const moveActiveRow = (delta) => setActiveRow(i => {
        if (sortedRepos.length === 0) return -1;
        return Math.min(sortedRepos.length - 1, Math.max(0, i + delta));
    });
    const activeRepo = sortedRepos[activeRow];
    useHotkeys({
        j: () => moveActiveRow(1),
        k: () => moveActiveRow(-1),
        x: () => { if (activeRepo) toggleSelectRepo(activeRepo.fullName); },
        o: () => { if (activeRepo) toggleExpand(activeRepo.id); },
        escape: () => { setActiveRow(-1); clearSelection(); },
    });
    useEffect(() => {
        if (activeRow >= sortedRepos.length) setActiveRow(sortedRepos.length - 1);
    }, [activeRow, sortedRepos.length]);
    useEffect(() => {
        if (activeRow < 0) return;
        tbodyRef.current?.querySelector('tr[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [activeRow]);

    const selectedList = useMemo(() => Array.from(selectedRepos), [selectedRepos]);
    const allRowsSelected = sortedRepos.length > 0 && sortedRepos.every(r => selectedRepos.has(r.fullName));
    const someRowsSelected = sortedRepos.some(r => selectedRepos.has(r.fullName));

    const toggleSelectAll = () => {
        setSelectedRepos(prev => {
            if (sortedRepos.every(r => prev.has(r.fullName))) {
                const next = new Set(prev);
                sortedRepos.forEach(r => next.delete(r.fullName));
                return next;
            }
            const next = new Set(prev);
            sortedRepos.forEach(r => next.add(r.fullName));
            return next;
        });
    };

    const handleBulkArchive = async () => {
        setBulkBusy(true);
        let okCount = 0;
        try {
            for (const fullName of selectedList) {
                const res = await apiFetch(`/api/repos/${fullName}/archive`, { method: 'POST' });
                if (res.ok) okCount++;
            }
            toast.success(`Archived ${okCount}/${selectedList.length} repos`);
            clearSelection();
            onDataChange?.();
        } catch (err) {
            toast.error(`Bulk archive failed: ${err.message}`);
        } finally {
            setBulkBusy(false);
        }
    };

    const handleBulkSetPriority = async (priority) => {
        setBulkBusy(true);
        try {
            const updates = selectedList.map(full_name => ({ full_name, priority }));
            const res = await apiFetch('/api/meta/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            });
            if (!res.ok) throw new Error('Bulk priority failed');
            toast.success(`Priority updated for ${updates.length} repos`);
            clearSelection();
            onDataChange?.();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBulkBusy(false);
        }
    };

    const handleBulkAddToGroup = async (group) => {
        setBulkBusy(true);
        let okCount = 0;
        try {
            for (const fullName of selectedList) {
                if (onAddToGroup) {
                    await onAddToGroup(group.id, fullName);
                    okCount++;
                }
            }
            toast.success(`Added ${okCount} repos to "${group.name}"`);
            clearSelection();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setBulkBusy(false);
        }
    };

    // Fetches the GitHub signals (standards, etc.) for a repo. Does not throw: returns ok/false.
    const syncSignals = async (fullName) => {
        let allOk = true;
        for (const kind of SIGNAL_KINDS) {
            try {
                const res = await apiFetch(`/api/repos/${fullName}/signals/sync?kinds=${kind}`, { method: 'POST' });
                const data = res.ok ? await res.json() : null;
                if (!data || data.ok === false) allOk = false;
            } catch {
                allOk = false;
            }
        }
        return allOk;
    };

    const handleSyncSignals = async (repo) => {
        setSyncingRepos(prev => new Set(prev).add(repo.id));
        const ok = await syncSignals(repo.fullName);
        if (ok) toast.success(`${repo.name} signals synced`);
        else toast.error(`Some signals failed for ${repo.name}`);
        setSyncingRepos(prev => {
            const next = new Set(prev);
            next.delete(repo.id);
            return next;
        });
        onDataChange?.();
    };

    // Brings the repo's configuration to the baseline. Returns how many settings it changed (null if it failed).
    const applyBaseline = async (fullName) => {
        try {
            const res = await apiFetch(`/api/repos/${fullName}/config/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Actor-Name': 'user', 'X-Actor-Type': 'human' },
                body: '{}',
            });
            const data = await res.json();
            if (!res.ok) return { error: data.error || 'Request failed' };
            return { applied: data.applied.length };
        } catch (error) {
            return { error: error.message };
        }
    };

    const [applyingConfig, setApplyingConfig] = useState(new Set());
    const handleApplyConfig = async (repo) => {
        setApplyingConfig(prev => new Set(prev).add(repo.id));
        const result = await applyBaseline(repo.fullName);
        if (result.error) toast.error(`${repo.name}: ${result.error}`);
        else toast.success(`${repo.name}: ${result.applied} settings updated`);
        setApplyingConfig(prev => {
            const next = new Set(prev);
            next.delete(repo.id);
            return next;
        });
        onDataChange?.();
    };

    // Only the selected repos that have drift and can be written to.
    const baselineTargets = sortedRepos.filter(r =>
        selectedRepos.has(r.fullName) && r.signals?.config?.canApply && r.signals.config.drift > 0
    );
    const handleBulkApplyBaseline = async () => {
        setBulkBusy(true);
        let okCount = 0;
        let changed = 0;
        for (const repo of baselineTargets) {
            const result = await applyBaseline(repo.fullName);
            if (!result.error) { okCount++; changed += result.applied; }
        }
        toast.success(`Baseline applied to ${okCount}/${baselineTargets.length} repos (${changed} settings)`);
        setBulkBusy(false);
        clearSelection();
        onDataChange?.();
    };

    const handleBulkSyncSignals = async () => {
        setBulkBusy(true);
        let okCount = 0;
        for (const fullName of selectedList) {
            if (await syncSignals(fullName)) okCount++;
        }
        toast.success(`Signals synced for ${okCount}/${selectedList.length} repos`);
        setBulkBusy(false);
        clearSelection();
        onDataChange?.();
    };

    const handleSync = async (repo) => {
        setSyncingRepos(prev => new Set(prev).add(repo.id));

        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}/health/sync`, {
                method: 'POST',
                headers: {
                    'X-Actor-Name': 'user',
                    'X-Actor-Type': 'human'
                }
            });

            if (response.ok) {
                const data = await response.json();
                toast.success(`${repo.name} synced!`);
                if (data.apps?.synced > 0) {
                    toast.success(`${data.apps.synced} apps synced`);
                }
                await syncSignals(repo.fullName);
                onDataChange?.();
            } else {
                const error = await response.json();
                toast.error(`Failed to sync ${repo.name}: ${error.error}`);
            }
        } catch (error) {
            toast.error(`Error: ${error.message}`);
        } finally {
            setSyncingRepos(prev => {
                const next = new Set(prev);
                next.delete(repo.id);
                return next;
            });
        }
    };

    const handleDeleteRepo = (repo) => {
        setDeletingRepo(repo);
    };

    const confirmDelete = async (repo) => {
        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}`, {
                method: 'DELETE',
                headers: {
                    'X-Actor-Name': 'user',
                    'X-Actor-Type': 'human'
                }
            });

            if (response.ok) {
                toast.success(`${repo.name} removed from database`);
                onDataChange?.();
            } else {
                const error = await response.json();
                toast.error(`Failed to delete: ${error.error}`);
            }
        } catch (error) {
            toast.error(`Error deleting repo: ${error.message}`);
        }
    };

    const toggleExpand = (repoId) => {
        setExpandedRepos(prev => {
            const next = new Set(prev);
            if (next.has(repoId)) next.delete(repoId);
            else next.add(repoId);
            return next;
        });
    };

    const handleAppSync = async (app) => {
        setSyncingApps(prev => new Set(prev).add(app.slug));
        try {
            const response = await apiFetch(`/api/repo-apps/${app.slug}/health/sync`, {
                method: 'POST',
                headers: { 'X-Actor-Name': 'user', 'X-Actor-Type': 'human' }
            });
            if (response.ok) {
                toast.success(`${app.appName} synced!`);
                onDataChange?.();
            } else {
                const error = await response.json();
                toast.error(`Failed to sync ${app.appName}: ${error.error}`);
            }
        } catch (error) {
            toast.error(`Error: ${error.message}`);
        } finally {
            setSyncingApps(prev => {
                const next = new Set(prev);
                next.delete(app.slug);
                return next;
            });
        }
    };

    const renderBool = (value) => {
        if (value === true) return <CheckCircle size={16} className="text-green-500 mx-auto" />;
        if (value === false) return <XCircle size={16} className="text-red-500 mx-auto" />;
        return <HelpCircle size={16} className="text-gray-300 mx-auto" />;
    };

    const docsQualityConfig = {
        excellent: { color: 'text-emerald-500', label: 'Excellent' },
        good: { color: 'text-green-500', label: 'Good' },
        needs_work: { color: 'text-orange-500', label: 'Needs work' },
        missing: { color: 'text-red-500', label: 'Missing' },
    };

    const renderDocsQuality = (quality) => {
        const config = docsQualityConfig[quality];
        if (!config) return <CheckCircle size={16} className="text-green-500 mx-auto" />;
        return (
            <span className={cn("font-semibold text-xs mx-auto block text-center", config.color)} title={config.label}>
                {config.label}
            </span>
        );
    };

    const renderStack = (stack) => {
        const stackColors = {
            python: 'bg-blue-100 text-blue-800',
            node: 'bg-green-100 text-green-800',
            php: 'bg-purple-100 text-purple-800',
            go: 'bg-cyan-100 text-cyan-800',
            java: 'bg-orange-100 text-orange-800',
            ruby: 'bg-red-100 text-red-800',
        };
        if (!stack) return <span className="text-gray-400">-</span>;

        return (
            <Badge className={cn("uppercase text-[10px]", stackColors[stack] || "bg-gray-100 text-gray-800")}>
                {stack === 'python' ? 'py' : stack === 'node' ? 'js' : stack}
            </Badge>
        );
    };

    const handlePriorityChange = async (repo, newPriority) => {
        setEditingPriority(null);
        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}/priority`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Actor-Name': 'user',
                    'X-Actor-Type': 'human'
                },
                body: JSON.stringify({ priority: newPriority })
            });
            if (response.ok) {
                toast.success(`${repo.name} priority set to ${newPriority}`);
                onDataChange?.();
            } else {
                toast.error('Failed to set priority');
            }
        } catch (error) {
            toast.error(`Error: ${error.message}`);
        }
    };

    const renderPriority = (repo) => {
        const colors = { 
            high: 'bg-red-50 text-red-700 border-red-200', 
            medium: 'bg-yellow-50 text-yellow-700 border-yellow-200', 
            low: 'bg-green-50 text-green-700 border-green-200',
            paused: 'bg-gray-100 text-gray-600 border-gray-300'
        };

        if (editingPriority === repo.id) {
            return (
                <select
                    autoFocus
                    className="text-xs border rounded px-1 py-0.5"
                    defaultValue={repo.priority || ''}
                    onChange={(e) => handlePriorityChange(repo, e.target.value)}
                    onBlur={() => setEditingPriority(null)}
                >
                    <option value="">None</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="paused">Paused</option>
                </select>
            );
        }

        return (
            <span
                onClick={() => setEditingPriority(repo.id)}
                className="cursor-pointer"
                title="Click to set priority"
            >
                {repo.priority
                    ? <Badge className={cn("border", colors[repo.priority])}>{repo.priority}</Badge>
                    : <span className="text-gray-300 hover:text-gray-500 transition-colors">+ set</span>
                }
            </span>
        );
    };

    const handleGroupChange = async (repo, groupSlug) => {
        setEditingGroup(null);
        const currentGroups = repo.groups || [];
        
        if (!groupSlug) {
            // Remove from all groups
            for (const g of currentGroups) {
                const group = groups.find(grp => grp.slug === g);
                if (group) {
                    await onRemoveFromGroup?.(group.id, repo.fullName);
                }
            }
        } else if (currentGroups.includes(groupSlug)) {
            // Remove from this group
            const group = groups.find(g => g.slug === groupSlug);
            if (group) {
                await onRemoveFromGroup?.(group.id, repo.fullName);
            }
        } else {
            // Add to this group (and remove from others for single-group mode)
            for (const g of currentGroups) {
                const group = groups.find(grp => grp.slug === g);
                if (group) {
                    await onRemoveFromGroup?.(group.id, repo.fullName);
                }
            }
            const group = groups.find(g => g.slug === groupSlug);
            if (group) {
                await onAddToGroup?.(group.id, repo.fullName);
            }
        }
        onDataChange?.();
    };

    const renderGroup = (repo) => {
        const repoGroups = repo.groups || [];
        const currentGroup = repoGroups[0]; // Single group mode
        const group = groups.find(g => g.slug === currentGroup);

        if (editingGroup === repo.id) {
            return (
                <select
                    autoFocus
                    className="text-xs border rounded px-1 py-0.5 max-w-[100px]"
                    defaultValue={currentGroup || ''}
                    onChange={(e) => handleGroupChange(repo, e.target.value)}
                    onBlur={() => setEditingGroup(null)}
                >
                    <option value="">None</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.slug}>{g.name}</option>
                    ))}
                </select>
            );
        }

        return (
            <span
                onClick={() => setEditingGroup(repo.id)}
                className="cursor-pointer"
                title="Click to set group"
            >
                {group
                    ? <Badge className="bg-blue-50 text-blue-700 border border-blue-200">{group.name}</Badge>
                    : <span className="text-gray-300 hover:text-gray-500 transition-colors">+ group</span>
                }
            </span>
        );
    };

    const renderRoadmap = (repo) => {
        if (repo.hasRoadmap === true) {
            return (
                <ExternalLink
                    href={`https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/docs/roadmap.md`}
                    title="View roadmap"
                >
                    <CheckCircle size={16} className="text-green-500 mx-auto" />
                </ExternalLink>
            );
        }
        if (repo.hasRoadmap === false) {
            return <XCircle size={16} className="text-red-500 mx-auto" />;
        }
        return <HelpCircle size={16} className="text-gray-300 mx-auto" />;
    };

    const formatSize = (kb) => {
        if (kb == null) return null;
        if (kb < 1024) return `${kb} KB`;
        if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
        return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
    };

    const formatLoc = (loc) => {
        if (loc == null) return null;
        return loc.toLocaleString(); // Shows: 86,396 instead of 86.4k
    };

    const coverageColor = (value) =>
        value >= 80 ? 'text-green-600' : value >= 50 ? 'text-yellow-600' : 'text-red-600';

    const renderCoverage = (repo) => {
        // Monorepo with apps: show average of app coverages (never fall through to legacy)
        if (repo.apps?.length > 0) {
            const appsWithCov = repo.apps.filter(a => a.coverageValue != null);
            if (appsWithCov.length > 0) {
                const avg = Math.round(appsWithCov.reduce((s, a) => s + a.coverageValue, 0) / appsWithCov.length);
                return <span className={cn("font-semibold font-mono", coverageColor(avg))}>{avg}%</span>;
            }
            return <span className="text-gray-400">-</span>;
        }
        // Simple repo: single coverage value
        const reports = repo.coverageReports;
        if (reports?.length === 1 && reports[0].label === 'default') {
            return <span className={cn("font-semibold font-mono", coverageColor(reports[0].coverage))}>{reports[0].coverage}%</span>;
        }
        if (reports?.length > 0) {
            const avg = Math.round(reports.reduce((s, r) => s + r.coverage, 0) / reports.length);
            return <span className={cn("font-semibold font-mono", coverageColor(avg))}>{avg}%</span>;
        }
        const coverage = repo.testCoverage;
        if (coverage == null) return <span className="text-gray-400">-</span>;
        return <span className={cn("font-semibold font-mono", coverageColor(coverage))}>{coverage}%</span>;
    };

    const SortHeader = ({ field, children, className }) => (
        <th
            onClick={() => handleSort(field)}
            className={cn(
                "px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors select-none",
                className
            )}
        >
            <div className="flex items-center gap-1">
                {children}
                {sortField === field && (
                    sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                )}
            </div>
        </th>
    );

    const total = repos.length;
    const stats = {
        withCi: repos.filter(r => aggregateBool(r, 'hasCi') === true).length,
        withTests: repos.filter(r => aggregateBool(r, 'hasTests') === true).length,
        withReadme: repos.filter(r => aggregateBool(r, 'hasReadme') === true).length,
        withRoadmap: repos.filter(r => r.hasRoadmap === true).length,
    };

    return (
        <Card className="overflow-hidden border-0 shadow-none">
            <div className="overflow-x-auto">
                <table className="w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="pl-4 pr-1 py-3 w-8">
                                <Checkbox
                                    checked={allRowsSelected}
                                    indeterminate={!allRowsSelected && someRowsSelected}
                                    onChange={toggleSelectAll}
                                    aria-label="Select all repos"
                                />
                            </th>
                            <SortHeader field="fullName" className="pl-2">Repo</SortHeader>
                            <SortHeader field="stack">Stack</SortHeader>
                            <SortHeader field="repoSizeKb">Size</SortHeader>
                            <SortHeader field="fileCount" className="text-center">Files</SortHeader>
                            <SortHeader field="loc" className="text-right">LOC</SortHeader>
                            <SortHeader field="hasReadme" className="text-center">📖 Readme {stats.withReadme}/{total}</SortHeader>
                            <SortHeader field="hasCi" className="text-center">🔧 CI {stats.withCi}/{total}</SortHeader>
                            <SortHeader field="hasTests" className="text-center">🧪 Tests {stats.withTests}/{total}</SortHeader>
                            <SortHeader field="hasRoadmap" className="text-center">📋 Roadmap {stats.withRoadmap}/{total}</SortHeader>
                            <SortHeader field="testCoverage" className="text-center">📊 Coverage</SortHeader>
                            <SortHeader field="healthScore" className="text-center">🏆 Score</SortHeader>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Signals</th>
                            <SortHeader field="priority">Priority</SortHeader>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Group</th>
                            <SortHeader field="lastHealthCheck">Last Check</SortHeader>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody ref={tbodyRef} className="bg-white divide-y divide-gray-200">
                        {sortedRepos.map((repo, rowIndex) => (
                            <React.Fragment key={repo.id}>
                            <tr
                                data-active={rowIndex === activeRow ? 'true' : undefined}
                                className={cn(
                                    "hover:bg-gray-50/50 transition-colors",
                                    repo.isDeleted && "opacity-50 bg-red-50",
                                    selectedRepos.has(repo.fullName) && "bg-blue-50/40",
                                    rowIndex === activeRow && "outline outline-2 -outline-offset-2 outline-blue-400 bg-blue-50/30"
                                )}
                            >
                                <td className="pl-4 pr-1 py-4 w-8">
                                    <Checkbox
                                        checked={selectedRepos.has(repo.fullName)}
                                        onChange={() => toggleSelectRepo(repo.fullName)}
                                        aria-label={`Select ${repo.fullName}`}
                                    />
                                </td>
                                <td className="px-2 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => toggleExpand(repo.id)}
                                            className="text-gray-400 hover:text-gray-600 p-0.5 -ml-1 flex-shrink-0"
                                            title={expandedRepos.has(repo.id) ? 'Collapse' : 'Expand (notas internas)'}
                                        >
                                            {expandedRepos.has(repo.id)
                                                ? <ChevronDown size={14} />
                                                : <ChevronRight size={14} />}
                                        </button>
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-1.5">
                                                <ExternalLink
                                                    href={`https://github.com/${repo.fullName}`}
                                                    className={cn(
                                                        "text-sm font-medium hover:underline",
                                                        repo.isDeleted ? "line-through text-gray-500" : "text-gray-900 hover:text-blue-600"
                                                    )}
                                                >{repo.name}</ExternalLink>
                                                <button
                                                    onClick={() => navigate(`/metrics/${repo.fullName}`)}
                                                    className="text-gray-400 hover:text-blue-600 flex-shrink-0"
                                                    title="Ver evolución (métricas históricas)"
                                                    aria-label={`Ver evolución de ${repo.fullName}`}
                                                >
                                                    <TrendingUp size={14} />
                                                </button>
                                                {repo.isMonorepo && (
                                                    <Badge className="bg-indigo-50 text-indigo-600 border-indigo-200 text-[9px] px-1">
                                                        {repo.apps.length} apps
                                                    </Badge>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-500">{repo.owner?.login}</span>
                                        </div>
                                        {repo.isArchived && <Badge variant="secondary">Archived</Badge>}
                                        {repo.isDeleted && (
                                            <Badge variant="danger" className="bg-red-100 text-red-700 border-red-300">
                                                Deleted
                                            </Badge>
                                        )}
                                        {!repo.isArchived && !repo.isDeleted && isStale(repo) && (
                                            <Badge
                                                className="bg-orange-50 text-orange-700 border-orange-200 text-[10px] px-1.5"
                                                title={`No commits in ${daysSinceLastCommit(repo)} days`}
                                            >
                                                Stale {daysSinceLastCommit(repo)}d
                                            </Badge>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    {renderStack(repo.stack)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {formatSize(repo.repoSizeKb) || <span className="text-gray-400">-</span>}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 text-center">
                                    {repo.fileCount != null ? repo.fileCount.toLocaleString() : <span className="text-gray-400">-</span>}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-mono">
                                    <div className="flex items-center justify-end gap-1.5">
                                        {formatLoc(repo.loc) || <span className="text-gray-400">-</span>}
                                        {repo.trend?.loc_delta != null && repo.trend.loc_delta !== 0 && (
                                            <TrendIndicator delta={repo.trend.loc_delta} />
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {(() => {
                                        const hasReadme = aggregateBool(repo, 'hasReadme');
                                        const docsQuality = aggregateDocsQuality(repo);
                                        return hasReadme === true ? (
                                            <ExternalLink href={`https://github.com/${repo.fullName}#readme`} title={`README: ${repo.readmeLines || 0} lines`}>
                                                {renderDocsQuality(docsQuality)}
                                            </ExternalLink>
                                        ) : renderBool(hasReadme);
                                    })()}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    <CiStatusBadge
                                        ciStatus={repo.ciStatus}
                                        ciStatusUrl={repo.ciStatusUrl || `https://github.com/${repo.fullName}/actions`}
                                        hasCi={aggregateBool(repo, 'hasCi')}
                                    />
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">{renderBool(aggregateBool(repo, 'hasTests'))}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">{renderRoadmap(repo)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">{renderCoverage(repo)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    <HealthScoreBadge healthScore={repo.healthScore} />
                                </td>
                                <td className="px-4 py-4"><SignalChips repo={repo} /></td>
                                <td className="px-4 py-4 whitespace-nowrap">{renderPriority(repo)}</td>
                                <td className="px-4 py-4 whitespace-nowrap">{renderGroup(repo)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {repo.lastHealthCheck
                                        ? new Date(repo.lastHealthCheck).toLocaleDateString()
                                        : <span className="text-gray-300 italic">never</span>
                                    }
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {repo.isDeleted ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDeleteRepo(repo)}
                                            className="text-red-400 hover:text-red-600 h-8 w-8"
                                            title="Remove from database"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    ) : (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setSummaryRepo(repo)}
                                                className="text-gray-400 hover:text-purple-600 h-8 w-8"
                                                title="AI summary"
                                            >
                                                <Sparkles size={16} />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleSync(repo)}
                                                disabled={syncingRepos.has(repo.id)}
                                                className={cn(
                                                    "text-gray-400 hover:text-blue-600 h-8 w-8",
                                                    syncingRepos.has(repo.id) && "animate-spin"
                                                )}
                                                title="Sync health data"
                                            >
                                                <RefreshCw size={16} />
                                            </Button>
                                        </>
                                    )}
                                </td>
                            </tr>

                            {/* Expanded app rows for monorepos */}
                            {repo.isMonorepo && expandedRepos.has(repo.id) && repo.apps.map(app => (
                                <tr
                                    key={`app-${app.slug}`}
                                    className="bg-gray-50/40 hover:bg-gray-100/50 transition-colors border-l-2 border-indigo-200"
                                >
                                    <td className="pl-4 pr-1 py-3 w-8" />
                                    <td className="pl-8 pr-6 py-3 whitespace-nowrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-300 text-xs">&#x2514;</span>
                                            <div className="flex flex-col">
                                                <ExternalLink href={`https://github.com/${repo.fullName}/tree/${repo.defaultBranch || 'main'}/${app.appPath}`} className="text-sm font-medium text-gray-700 hover:text-blue-600">
                                                    {app.appName}
                                                </ExternalLink>
                                                <span className="text-[11px] text-gray-400">{app.appPath}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap">{renderStack(app.stack)}</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">—</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-center">
                                        {app.fileCount != null ? app.fileCount.toLocaleString() : <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-mono">
                                        {app.loc != null ? app.loc.toLocaleString() : <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                        {app.hasReadme === true ? (
                                            <ExternalLink href={`https://github.com/${repo.fullName}/tree/${repo.defaultBranch || 'main'}/${app.appPath}#readme`} title={`README: ${app.readmeLines || 0} lines`}>
                                                {renderDocsQuality(app.docsQuality)}
                                            </ExternalLink>
                                        ) : renderBool(app.hasReadme)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                        {app.hasCi === true ? (
                                            <ExternalLink href={`https://github.com/${repo.fullName}/actions`} title="View CI">
                                                <CheckCircle size={16} className="text-green-500 mx-auto" />
                                            </ExternalLink>
                                        ) : renderBool(app.hasCi)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                        {app.hasTests === true ? (
                                            <ExternalLink href={`https://github.com/${repo.fullName}/tree/${repo.defaultBranch || 'main'}/${app.appPath}`} title="View app directory">
                                                <CheckCircle size={16} className="text-green-500 mx-auto" />
                                            </ExternalLink>
                                        ) : renderBool(app.hasTests)}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center text-gray-400">—</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                        {app.coverageValue != null
                                            ? <span className={cn("font-semibold font-mono text-xs", coverageColor(app.coverageValue))}>{app.coverageValue}%</span>
                                            : <span className="text-gray-400">—</span>
                                        }
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">—</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">—</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-gray-400">—</td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                        {app.lastHealthCheck
                                            ? new Date(app.lastHealthCheck).toLocaleDateString()
                                            : <span className="text-gray-300 italic">never</span>
                                        }
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleAppSync(app)}
                                            disabled={syncingApps.has(app.slug)}
                                            className={cn(
                                                "text-gray-400 hover:text-blue-600 h-7 w-7",
                                                syncingApps.has(app.slug) && "animate-spin"
                                            )}
                                            title="Sync app health"
                                        >
                                            <RefreshCw size={14} />
                                        </Button>
                                    </td>
                                </tr>
                            ))}

                            {/* Internal notes (all repos) */}
                            {expandedRepos.has(repo.id) && (
                                <tr className="bg-gray-50/40 border-l-2 border-blue-200">
                                    <td className="w-8" />
                                    <td colSpan={16} className="py-1">
                                        {!repo.isDeleted && (
                                            <RepoSignals
                                                repo={repo}
                                                syncing={syncingRepos.has(repo.id)}
                                                onSync={() => handleSyncSignals(repo)}
                                                onCleanupBranches={() => setCleanupRepo(repo)}
                                                onApplyConfig={() => handleApplyConfig(repo)}
                                                applyingConfig={applyingConfig.has(repo.id)}
                                            />
                                        )}
                                        <RepoNotes
                                            repo={repo}
                                            onSave={(notes) => onUpdateNotes(repo.fullName, notes)}
                                        />
                                    </td>
                                </tr>
                            )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {deletingRepo && (
                <DeleteRepoModal
                    repo={deletingRepo}
                    onClose={() => setDeletingRepo(null)}
                    onConfirm={confirmDelete}
                />
            )}

            <BulkActionBar
                count={selectedRepos.size}
                groups={groups}
                busy={bulkBusy}
                onArchive={handleBulkArchive}
                onSetPriority={handleBulkSetPriority}
                onAddToGroup={handleBulkAddToGroup}
                onSyncSignals={handleBulkSyncSignals}
                baselineCount={baselineTargets.length}
                onApplyBaseline={handleBulkApplyBaseline}
                onClear={clearSelection}
            />

            {cleanupRepo && (
                <BranchCleanupModal
                    repo={cleanupRepo}
                    onClose={() => setCleanupRepo(null)}
                    onDone={() => onDataChange?.()}
                />
            )}

            {summaryRepo && (
                <AiSummaryModal repo={summaryRepo} onClose={() => setSummaryRepo(null)} />
            )}
        </Card>
    );
}
