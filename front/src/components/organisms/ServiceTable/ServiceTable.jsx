import React, { useState } from 'react';
import { Card } from '../../atoms/Card';
import { Badge } from '../../atoms/Badge';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { ExternalLink } from '../../atoms/ExternalLink';
import { StatusDot } from '../../atoms/StatusDot';
import { RefreshCw, ExternalLink as LinkIcon, Trash2, Edit, ArrowUpDown } from 'lucide-react';
import { formatTimeAgo } from '../../../lib/formatters';
import { UptimeCell } from '../../molecules/UptimeCell';
import { useServiceUptime } from '../../../hooks/useServiceUptime';

const PROVIDER_LABELS = {
    gcp: 'GCP',
    cloudflare: 'Cloudflare',
    vercel: 'Vercel',
    aws: 'AWS',
    railway: 'Railway',
    render: 'Render',
    fly: 'Fly.io',
    heroku: 'Heroku',
    other: 'Other',
};

const STATUS_BADGE_VARIANT = {
    healthy: 'success',
    degraded: 'warning',
    down: 'danger',
    unknown: 'default',
};

export function ServiceTable({
    services,
    loading,
    onCheckHealth,
    onCheckAllHealth,
    onEdit,
    onDelete,
    checkingSlug,
    checkingAll,
}) {
    // Refetched when the last check of any service changes.
    const uptime = useServiceUptime(services.map(s => `${s.slug}:${s.lastCheckAt || ''}`).join('|'));
    const [sortField, setSortField] = useState('name');
    const [sortDir, setSortDir] = useState('asc');

    const toggleSort = (field) => {
        if (sortField === field) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir('asc');
        }
    };

    const sorted = [...services].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        switch (sortField) {
            case 'name': return dir * a.name.localeCompare(b.name);
            case 'provider': return dir * a.provider.localeCompare(b.provider);
            case 'status': {
                const sa = a.lastCheckStatus || 'unknown';
                const sb = b.lastCheckStatus || 'unknown';
                return dir * sa.localeCompare(sb);
            }
            case 'responseMs': {
                const ma = a.lastCheckResponseMs ?? 99999;
                const mb = b.lastCheckResponseMs ?? 99999;
                return dir * (ma - mb);
            }
            default: return 0;
        }
    });

    const SortHeader = ({ field, children }) => (
        <th
            className="pb-2 text-sm text-gray-400 cursor-pointer select-none hover:text-gray-600"
            onClick={() => toggleSort(field)}
        >
            <div className="flex items-center gap-1">
                {children}
                {sortField === field && (
                    <ArrowUpDown className="w-3 h-3" />
                )}
            </div>
        </th>
    );

    if (loading) {
        return (
            <Card className="p-8 text-center">
                <Text className="text-gray-400">Loading services...</Text>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header with Check All */}
            <div className="flex items-center justify-between">
                <Text variant="small" className="text-gray-500">
                    {sorted.length} service{sorted.length !== 1 ? 's' : ''}
                </Text>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onCheckAllHealth}
                    disabled={checkingAll}
                    className="gap-2"
                >
                    <RefreshCw className={`w-4 h-4 ${checkingAll ? 'animate-spin' : ''}`} />
                    Check All
                </Button>
            </div>

            {/* Table */}
            {sorted.length === 0 ? (
                <Card className="p-8 text-center">
                    <Text className="text-gray-400">No services found</Text>
                </Card>
            ) : (
                <Card className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left border-b border-gray-200">
                                <SortHeader field="status">Status</SortHeader>
                                <SortHeader field="name">Name</SortHeader>
                                <th className="pb-2 text-sm text-gray-400">URL</th>
                                <SortHeader field="provider">Provider</SortHeader>
                                <th className="pb-2 text-sm text-gray-400">Env</th>
                                <th className="pb-2 text-sm text-gray-400">Source Repo</th>
                                <SortHeader field="responseMs">Response</SortHeader>
                                <th className="pb-2 text-sm text-gray-400">Uptime 30d</th>
                                <th className="pb-2 text-sm text-gray-400">Last Check</th>
                                <th className="pb-2 text-sm text-gray-400 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((service) => {
                                const status = service.lastCheckStatus || 'unknown';
                                const responseMs = service.lastCheckResponseMs;
                                const lastCheck = service.lastCheckAt;
                                const sourceRepo = service.sourceRepoFullName;
                                const sourcePath = service.sourcePath;
                                const isChecking = checkingSlug === service.slug;

                                return (
                                    <tr key={service.slug} className="border-b border-gray-100 hover:bg-gray-50/50">
                                        <td className="py-3 px-2">
                                            <div className="flex items-center gap-2">
                                                <StatusDot status={status} />
                                                <Badge variant={STATUS_BADGE_VARIANT[status]}>{status}</Badge>
                                            </div>
                                        </td>
                                        <td className="py-3 px-2">
                                            <Text weight="medium">{service.name}</Text>
                                            {service.description && (
                                                <Text size="sm" className="text-gray-400 truncate max-w-[200px]">
                                                    {service.description}
                                                </Text>
                                            )}
                                        </td>
                                        <td className="py-3 px-2">
                                            {service.url ? (
                                                <ExternalLink
                                                    href={service.url}
                                                    className="text-blue-500 hover:text-blue-600 text-sm flex items-center gap-1"
                                                >
                                                    <LinkIcon className="w-3 h-3" />
                                                    <span className="truncate max-w-[200px]">
                                                        {service.url.replace(/^https?:\/\//, '')}
                                                    </span>
                                                </ExternalLink>
                                            ) : (
                                                <Text size="sm" className="text-gray-400">—</Text>
                                            )}
                                        </td>
                                        <td className="py-3 px-2">
                                            <Badge variant="outline">{PROVIDER_LABELS[service.provider] || service.provider}</Badge>
                                        </td>
                                        <td className="py-3 px-2">
                                            <Text size="sm">{service.env}</Text>
                                        </td>
                                        <td className="py-3 px-2">
                                            {sourceRepo ? (
                                                <div>
                                                    <ExternalLink
                                                        href={`https://github.com/${sourceRepo}`}
                                                        className="text-sm text-gray-600 hover:text-gray-900"
                                                    >
                                                        {sourceRepo}
                                                    </ExternalLink>
                                                    {sourcePath && (
                                                        <Text size="sm" className="text-gray-400">/{sourcePath}</Text>
                                                    )}
                                                </div>
                                            ) : (
                                                <Text size="sm" className="text-gray-400">—</Text>
                                            )}
                                        </td>
                                        <td className="py-3 px-2">
                                            {responseMs != null ? (
                                                <Text size="sm" className={responseMs > 2000 ? 'text-yellow-600' : 'text-gray-600'}>
                                                    {responseMs}ms
                                                </Text>
                                            ) : (
                                                <Text size="sm" className="text-gray-400">—</Text>
                                            )}
                                        </td>
                                        <td className="py-3 px-2">
                                            <UptimeCell uptime={uptime[service.slug]} />
                                        </td>
                                        <td className="py-3 px-2">
                                            <Text size="sm" className="text-gray-400">
                                                {lastCheck ? formatTimeAgo(lastCheck) : 'never'}
                                            </Text>
                                        </td>
                                        <td className="py-3 px-2 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onCheckHealth(service.slug)}
                                                    disabled={isChecking || !service.url}
                                                    title="Health check"
                                                >
                                                    <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onEdit(service)}
                                                    title="Edit"
                                                >
                                                    <Edit className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onDelete(service.slug)}
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4 text-red-400" />
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </Card>
            )}
        </div>
    );
}
