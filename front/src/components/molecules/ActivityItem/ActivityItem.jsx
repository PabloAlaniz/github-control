import React from 'react';
import { cn } from '../../../lib/utils';
import { ActivityBadge } from '../../atoms/ActivityBadge';
import { 
    FolderPlus, 
    FolderMinus, 
    Flag, 
    TrendingUp, 
    CheckCircle, 
    XCircle,
    FileText,
    Settings,
    AlertTriangle,
    Trash2
} from 'lucide-react';

const actionIcons = {
    'group.add': FolderPlus,
    'group.remove': FolderMinus,
    'group.create': FolderPlus,
    'group.delete': Trash2,
    'priority.set': Flag,
    'completion.set': TrendingUp,
    'health.update': CheckCircle,
    'health.ci': Settings,
    'health.tests': CheckCircle,
    'health.readme': FileText,
    'blocker.add': AlertTriangle,
    'blocker.remove': XCircle,
    'meta.notes': FileText,
    'meta.client': Settings,
};

const actionLabels = {
    'group.add': 'Added to group',
    'group.remove': 'Removed from group',
    'group.create': 'Created group',
    'group.delete': 'Deleted group',
    'priority.set': 'Set priority',
    'completion.set': 'Updated completion',
    'health.update': 'Updated health',
    'health.ci': 'Updated CI status',
    'health.tests': 'Updated tests status',
    'health.readme': 'Updated README status',
    'blocker.add': 'Added blocker',
    'blocker.remove': 'Removed blocker',
    'meta.notes': 'Updated notes',
    'meta.client': 'Updated client',
};

function formatTimeAgo(date) {
    const now = new Date();
    const then = new Date(date);
    const seconds = Math.floor((now - then) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return then.toLocaleDateString();
}

function getActionColor(action) {
    if (action.includes('add') || action.includes('create')) return 'text-green-600';
    if (action.includes('remove') || action.includes('delete')) return 'text-red-600';
    if (action.includes('priority')) return 'text-amber-600';
    if (action.includes('health')) return 'text-blue-600';
    return 'text-gray-600';
}

export function ActivityItem({ activity, showRepo = true, className }) {
    const {
        action,
        entityType,
        entityId,
        fieldChanged,
        oldValue,
        newValue,
        actorType,
        actorName,
        createdAt
    } = activity;

    const Icon = actionIcons[action] || Settings;
    const label = actionLabels[action] || action.replace('.', ' ');
    const iconColor = getActionColor(action);

    return (
        <div className={cn("flex items-start gap-3 py-3 border-b border-gray-100 last:border-0", className)}>
            <div className={cn("mt-0.5 p-1.5 rounded-full bg-gray-50", iconColor)}>
                <Icon size={14} />
            </div>
            
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <ActivityBadge actorType={actorType} actorName={actorName} />
                    <span className="text-sm text-gray-700">{label}</span>
                </div>
                
                {showRepo && entityType === 'repo' && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {entityId}
                    </div>
                )}
                
                {(oldValue || newValue) && (
                    <div className="flex items-center gap-2 mt-1 text-xs">
                        {oldValue && (
                            <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded line-through">
                                {oldValue}
                            </span>
                        )}
                        {oldValue && newValue && <span className="text-gray-400">→</span>}
                        {newValue && (
                            <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded">
                                {newValue}
                            </span>
                        )}
                    </div>
                )}
            </div>
            
            <div className="text-xs text-gray-400 whitespace-nowrap">
                {formatTimeAgo(createdAt)}
            </div>
        </div>
    );
}
