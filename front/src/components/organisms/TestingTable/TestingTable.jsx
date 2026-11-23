import React, { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../../atoms/Card';
import { Badge } from '../../atoms/Badge';
import { Button } from '../../atoms/Button';
import { ExternalLink } from '../../atoms/ExternalLink';
import { cn } from '../../../lib/utils';
import { RefreshCw, CheckCircle, XCircle, HelpCircle, Play } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import {
    renderBool,
    renderBoolWithLabel,
    renderStack,
    renderCoverage,
    SortHeader,
    avgCoverage,
} from '../shared/tableHelpers';

export function TestingTable({ repos, groups = [], healthFilter = 'all', priorityFilter = 'all', onDataChange, onAddToGroup, onRemoveFromGroup }) {
    const [sortField, setSortField] = useState('priority');
    const [sortDir, setSortDir] = useState('desc');
    const [editingPriority, setEditingPriority] = useState(null);
    const [syncingRepos, setSyncingRepos] = useState(new Set());
    const [dispatchingRepos, setDispatchingRepos] = useState(new Set());

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const sortedRepos = useMemo(() => {
        let filtered = [...repos];

        switch (healthFilter) {
            case 'needs-tests':
                filtered = filtered.filter(r => r.hasTests === false || r.hasTests === null);
                break;
            case 'needs-ci':
                filtered = filtered.filter(r => r.hasCi === false || r.hasCi === null);
                break;
            case 'unchecked':
                filtered = filtered.filter(r => r.hasCi === null && r.hasTests === null);
                break;
            case 'deleted':
                filtered = filtered.filter(r => r.isDeleted === true);
                break;
            case 'paused':
                filtered = filtered.filter(r => r.priority === 'paused');
                break;
        }

        if (priorityFilter !== 'all') {
            if (priorityFilter === 'none') {
                filtered = filtered.filter(r => !r.priority);
            } else {
                filtered = filtered.filter(r => r.priority === priorityFilter);
            }
        }

        filtered.sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];

            if (sortField === 'testCoverage') {
                aVal = avgCoverage(a);
                bVal = avgCoverage(b);
            }

            if (sortField === 'priority') {
                const priorityOrder = { high: 4, medium: 3, low: 2, paused: 1 };
                aVal = priorityOrder[aVal] || 0;
                bVal = priorityOrder[bVal] || 0;
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

    const handleSync = async (repo) => {
        setSyncingRepos(prev => new Set(prev).add(repo.id));
        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}/health/sync`, {
                method: 'POST',
                headers: { 'X-Actor-Name': 'user', 'X-Actor-Type': 'human' }
            });
            if (response.ok) {
                toast.success(`${repo.name} synced!`);
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

    const handleDispatchCoverage = async (repo) => {
        setDispatchingRepos(prev => new Set(prev).add(repo.id));
        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}/coverage/compute`, {
                method: 'POST',
            });
            if (response.ok) {
                const data = await response.json();
                const extra = data.workflowCreated ? ' Workflow created.' : '';
                toast.success(`Coverage dispatched for ${repo.name}!${extra}`);
            } else {
                const error = await response.json();
                toast.error(`Failed: ${error.error}`);
            }
        } catch (error) {
            toast.error(`Error: ${error.message}`);
        } finally {
            setDispatchingRepos(prev => {
                const next = new Set(prev);
                next.delete(repo.id);
                return next;
            });
        }
    };

    const handlePriorityChange = async (repo, newPriority) => {
        setEditingPriority(null);
        try {
            const response = await apiFetch(`/api/repos/${repo.fullName}/priority`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Actor-Name': 'user', 'X-Actor-Type': 'human' },
                body: JSON.stringify({ priority: newPriority })
            });
            if (response.ok) {
                toast.success(`${repo.name} priority set to ${newPriority}`);
                onDataChange?.();
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
            <span onClick={() => setEditingPriority(repo.id)} className="cursor-pointer" title="Click to set priority">
                {repo.priority
                    ? <Badge className={cn("border", colors[repo.priority])}>{repo.priority}</Badge>
                    : <span className="text-gray-300 hover:text-gray-500 transition-colors">+ set</span>
                }
            </span>
        );
    };

    const total = repos.length;

    return (
        <Card className="overflow-hidden border-0 shadow-none">
            <div className="overflow-x-auto">
                <table className="w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <SortHeader field="fullName" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="pl-6">Repo</SortHeader>
                            <SortHeader field="stack" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Stack</SortHeader>
                            <SortHeader field="hasUnitTests" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Unit</SortHeader>
                            <SortHeader field="hasIntegrationTests" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Integration</SortHeader>
                            <SortHeader field="hasE2eTests" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">E2E</SortHeader>
                            <SortHeader field="testCoverage" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Coverage</SortHeader>
                            <SortHeader field="hasLintConfig" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Lint</SortHeader>
                            <SortHeader field="hasTypeChecking" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Type Check</SortHeader>
                            <SortHeader field="hasSecurityScan" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Security Scan</SortHeader>
                            <SortHeader field="hasPerfTests" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">Perf Tests</SortHeader>
                            <SortHeader field="hasCi" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-center">CI Pipeline</SortHeader>
                            <SortHeader field="priority" sortField={sortField} sortDir={sortDir} onSort={handleSort}>Priority</SortHeader>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {sortedRepos.map((repo) => (
                            <tr
                                key={repo.id}
                                className={cn(
                                    "hover:bg-gray-50/50 transition-colors",
                                    repo.isDeleted && "opacity-50 bg-red-50"
                                )}
                            >
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col">
                                            <ExternalLink
                                                href={`https://github.com/${repo.fullName}`}
                                                className={cn(
                                                    "text-sm font-medium hover:underline",
                                                    repo.isDeleted ? "line-through text-gray-500" : "text-gray-900 hover:text-blue-600"
                                                )}
                                            >{repo.name}</ExternalLink>
                                            <span className="text-xs text-gray-500">{repo.owner?.login}</span>
                                        </div>
                                        {repo.isArchived && <Badge variant="secondary">Archived</Badge>}
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    {renderStack(repo.stack)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBoolWithLabel(repo.hasUnitTests, repo.testFramework)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBool(repo.hasIntegrationTests)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBoolWithLabel(repo.hasE2eTests, repo.e2eFramework)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderCoverage(repo)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBoolWithLabel(repo.hasLintConfig, repo.lintTool)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBool(repo.hasTypeChecking)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBool(repo.hasSecurityScan)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {renderBool(repo.hasPerfTests)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {repo.hasCi === true ? (
                                        <ExternalLink href={`https://github.com/${repo.fullName}/actions`} title="View CI">
                                            <CheckCircle size={16} className="text-green-500 mx-auto" />
                                        </ExternalLink>
                                    ) : renderBool(repo.hasCi)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    {renderPriority(repo)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-center">
                                    <div className="flex items-center justify-center gap-1">
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
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleDispatchCoverage(repo)}
                                            disabled={dispatchingRepos.has(repo.id)}
                                            className={cn(
                                                "text-gray-400 hover:text-green-600 h-8 w-8",
                                                dispatchingRepos.has(repo.id) && "animate-pulse"
                                            )}
                                            title="Run coverage — creates a GitHub Actions workflow in the repo and triggers it to compute and report test coverage"
                                        >
                                            <Play size={16} />
                                        </Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
