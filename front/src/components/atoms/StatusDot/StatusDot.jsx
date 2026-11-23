import React from 'react';
import { cn } from '../../../lib/utils';

const statusColors = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
    unknown: 'bg-gray-400',
};

const sizes = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-3.5 h-3.5',
};

export function StatusDot({ status = 'unknown', size = 'md', className, ...props }) {
    return (
        <span
            className={cn(
                'rounded-full inline-block flex-shrink-0',
                sizes[size],
                statusColors[status] || statusColors.unknown,
                className
            )}
            title={status}
            {...props}
        />
    );
}
