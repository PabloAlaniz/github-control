import React from 'react';
import { Card, CardContent } from '../../atoms/Card';
import { Text } from '../../atoms/Text';
import { Icon } from '../../atoms/Icon';
import { cn } from '../../../lib/utils';

export function StatCard({
    label,
    value,
    icon,
    variant = 'default',
    className
}) {
    const variants = {
        default: 'text-gray-900',
        primary: 'text-blue-600',
        success: 'text-green-600',
        warning: 'text-yellow-600',
        danger: 'text-red-600',
        muted: 'text-gray-500',
        active: 'text-green-600 bg-green-50/50',
        inactive: 'text-yellow-600 bg-yellow-50/50',
        abandoned: 'text-red-600 bg-red-50/50',
    };

    const cardVariants = {
        default: 'bg-white',
        danger: 'border-red-100 bg-red-50/30',
        warning: 'border-yellow-100 bg-yellow-50/30',
        success: 'border-green-100 bg-green-50/30',
        muted: 'border-gray-100 bg-gray-50/30',
        active: 'border-green-100 bg-green-50/30',
        inactive: 'border-yellow-100 bg-yellow-50/30',
        abandoned: 'border-red-100 bg-red-50/30',
    };

    return (
        <Card className={cn('flex flex-col items-center justify-center p-4', cardVariants[variant] || cardVariants.default, className)}>
            <Text variant="h2" className={cn(variants[variant] || variants.default)}>
                {value}
            </Text>
            <div className="flex items-center gap-1.5 mt-1">
                {icon && <Icon icon={icon} size={14} className="text-gray-500" />}
                <Text variant="small" className="font-medium text-gray-500 uppercase tracking-wider">
                    {label}
                </Text>
            </div>
        </Card>
    );
}
