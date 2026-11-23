import React, { useState, useEffect } from 'react';
import { Card } from '../../atoms/Card';
import { Text } from '../../atoms/Text';
import { Select } from '../../atoms/Select';
import { Button } from '../../atoms/Button';
import { ColorDot } from '../../atoms/ColorDot';
import { ActivityItem } from '../../molecules/ActivityItem';
import { ErrorState } from '../../molecules/ErrorState';
import { Activity, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { apiFetch } from '../../../lib/api';

export function ActivityFeed({ 
    repoFullName = null, 
    limit = 20, 
    showFilters = true,
    className 
}) {
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actorFilter, setActorFilter] = useState('all');
    const [stats, setStats] = useState([]);

    const fetchActivities = async () => {
        setLoading(true);
        setError(null);
        try {
            let path;
            if (repoFullName) {
                const [owner, repo] = repoFullName.split('/');
                path = `/api/repos/${owner}/${repo}/activity?limit=${limit}`;
            } else {
                path = `/api/activity?limit=${limit}`;
                if (actorFilter !== 'all') {
                    path += `&actorName=${actorFilter}`;
                }
            }

            const response = await apiFetch(path);
            if (!response.ok) throw new Error('Failed to fetch activities');
            const data = await response.json();
            
            // Handle both formats: array or { activities, total }
            setActivities(Array.isArray(data) ? data : data.activities || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await apiFetch('/api/activity/by-actor');
            if (response.ok) {
                const data = await response.json();
                setStats(data);
            }
        } catch (err) {
            console.error('Failed to fetch activity stats:', err);
        }
    };

    useEffect(() => {
        fetchActivities();
        if (!repoFullName && showFilters) {
            fetchStats();
        }
    }, [repoFullName, limit, actorFilter]);

    const actorOptions = [
        { value: 'all', label: 'All actors' },
        ...stats.map(s => ({ 
            value: s.actorName, 
            label: `${s.actorName} (${s.totalActions})` 
        }))
    ];

    if (error) {
        return <ErrorState variant="inline" message={`Failed to load activity: ${error}`} icon={Activity} className={className} />;
    }

    return (
        <Card className={cn("overflow-hidden", className)}>
            <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Activity size={18} className="text-gray-500" />
                        <Text variant="h4" className="font-semibold">
                            {repoFullName ? 'Repo Activity' : 'Activity Log'}
                        </Text>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {showFilters && !repoFullName && stats.length > 0 && (
                            <Select
                                value={actorFilter}
                                onChange={(e) => setActorFilter(e.target.value)}
                                className="w-40 text-sm"
                            >
                                {actorOptions.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </Select>
                        )}
                        
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={fetchActivities}
                            disabled={loading}
                            className="h-8 w-8"
                        >
                            <RefreshCw
                                size={16}
                                className={cn("text-gray-500", loading && "animate-spin")}
                            />
                        </Button>
                    </div>
                </div>
            </div>
            
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                {loading && activities.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                        <Text variant="muted">Loading activity...</Text>
                    </div>
                ) : activities.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        <Activity size={24} className="mx-auto mb-2 opacity-50" />
                        <Text variant="muted">No activity yet</Text>
                    </div>
                ) : (
                    <div className="px-4">
                        {activities.map((activity) => (
                            <ActivityItem
                                key={activity.id}
                                activity={activity}
                                showRepo={!repoFullName}
                            />
                        ))}
                    </div>
                )}
            </div>
            
            {!repoFullName && stats.length > 0 && (
                <div className="p-3 border-t border-gray-100 bg-gray-50/30">
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        {stats.slice(0, 5).map(s => (
                            <span key={s.actorName} className="flex items-center gap-1">
                                <ColorDot
                                    color={s.actorType === 'agent' ? '#818cf8' : '#fbbf24'}
                                    size="sm"
                                />
                                {s.actorName}: {s.totalActions}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}
