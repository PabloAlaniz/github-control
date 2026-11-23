import React from 'react';
import { StatCard } from '../../molecules/StatCard';
import { cn } from '../../../lib/utils';
import {
    LayoutGrid,
    AlertCircle,
    AlertTriangle,
    CheckCircle,
    Star,
    HelpCircle
} from 'lucide-react';
import { formatTimeAgo } from '../../../lib/formatters';

export function StatsOverview({ repos, cacheInfo }) {
    // Filter out archived and deleted for priority stats
    const activeRepos = repos.filter(r => !r.isArchived && !r.isDeleted);

    const stats = {
        total: activeRepos.length,
        highPriority: activeRepos.filter(r => r.priority === 'high').length,
        mediumPriority: activeRepos.filter(r => r.priority === 'medium').length,
        lowPriority: activeRepos.filter(r => r.priority === 'low').length,
        noPriority: activeRepos.filter(r => !r.priority).length,
    };

    const totalStars = repos.reduce((sum, r) => sum + (r.stars || 0), 0);
    const lastUpdated = cacheInfo?.cachedAt ? formatTimeAgo(cacheInfo.cachedAt) : null;

    return (
        <div className="space-y-4">
            {lastUpdated && (
                <div className="text-xs text-gray-500 text-right">
                    Last updated: {lastUpdated}
                </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard
                    label="Total Repos"
                    value={stats.total}
                    icon={LayoutGrid}
                />
                <StatCard
                    label="High Priority"
                    value={stats.highPriority}
                    variant="danger"
                    icon={AlertCircle}
                />
                <StatCard
                    label="Medium Priority"
                    value={stats.mediumPriority}
                    variant="warning"
                    icon={AlertTriangle}
                />
                <StatCard
                    label="Low Priority"
                    value={stats.lowPriority}
                    variant="success"
                    icon={CheckCircle}
                />
                <StatCard
                    label="No Priority"
                    value={stats.noPriority}
                    variant="muted"
                    icon={HelpCircle}
                />
                <StatCard
                    label="Stars"
                    value={totalStars}
                    variant="primary"
                    icon={Star}
                />
            </div>
        </div>
    );
}
