import { CheckCircle, XCircle, Clock, AlertCircle, MinusCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * Visualizes the latest workflow run status for a repo.
 *
 * Status values mirror GitHub's workflow run conclusion (when completed) or
 * status (when in-flight). Falls back to a generic icon for the `hasCi` boolean
 * when no run data is available yet.
 */

const STATUS_CONFIG = {
    success:        { Icon: CheckCircle,  color: 'text-green-500',  label: 'CI passing' },
    failure:        { Icon: XCircle,      color: 'text-red-500',    label: 'CI failed' },
    cancelled:      { Icon: MinusCircle,  color: 'text-gray-400',   label: 'CI cancelled' },
    skipped:        { Icon: MinusCircle,  color: 'text-gray-400',   label: 'CI skipped' },
    timed_out:      { Icon: AlertCircle,  color: 'text-orange-500', label: 'CI timed out' },
    action_required:{ Icon: AlertCircle,  color: 'text-orange-500', label: 'CI action required' },
    startup_failure:{ Icon: XCircle,      color: 'text-red-500',    label: 'CI startup failure' },
    in_progress:    { Icon: Clock,        color: 'text-blue-500',   label: 'CI in progress' },
    queued:         { Icon: Clock,        color: 'text-blue-400',   label: 'CI queued' },
    neutral:        { Icon: MinusCircle,  color: 'text-gray-400',   label: 'CI neutral' },
    stale:          { Icon: AlertCircle,  color: 'text-yellow-500', label: 'CI stale' },
};

export function CiStatusBadge({ ciStatus, ciStatusUrl, hasCi, className }) {
    if (ciStatus && STATUS_CONFIG[ciStatus]) {
        const { Icon, color, label } = STATUS_CONFIG[ciStatus];
        const node = (
            <Icon
                size={16}
                className={cn(color, 'mx-auto', className)}
                aria-label={label}
            />
        );
        return ciStatusUrl ? (
            <a href={ciStatusUrl} target="_blank" rel="noopener noreferrer" title={label} className="inline-block">
                {node}
            </a>
        ) : (
            <span title={label}>{node}</span>
        );
    }

    // Fallback to static hasCi indicator when no run data has been synced yet.
    if (hasCi === true) {
        return <CheckCircle size={16} className={cn('text-green-500/60 mx-auto', className)} aria-label="CI configured (no recent run)" />;
    }
    if (hasCi === false) {
        return <XCircle size={16} className={cn('text-red-500/60 mx-auto', className)} aria-label="No CI" />;
    }
    return <MinusCircle size={16} className={cn('text-gray-300 mx-auto', className)} aria-label="CI unknown" />;
}
