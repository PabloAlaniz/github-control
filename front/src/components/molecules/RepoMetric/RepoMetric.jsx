import React from 'react';
import { Icon } from '../../atoms/Icon';
import { Text } from '../../atoms/Text';
import { cn } from '../../../lib/utils';

export function RepoMetric({
    icon,
    value,
    label,
    className
}) {
    if (value === undefined || value === null || value === 0) return null;

    return (
        <div
            className={cn("flex items-center gap-1.5 text-gray-600", className)}
            title={label}
        >
            <Icon icon={icon} size={16} className="text-gray-500" />
            <Text variant="p" className="text-sm font-medium">
                {value}
            </Text>
        </div>
    );
}
