import React from 'react';
import { Select } from '../../atoms/Select';
import { Text } from '../../atoms/Text';
import { cn } from '../../../lib/utils';

export function FilterGroup({
    label,
    children,
    className
}) {
    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            {label && (
                <Text variant="small" className="text-gray-500 font-medium ml-1">
                    {label}
                </Text>
            )}
            <div className="flex-1">
                {children}
            </div>
        </div>
    );
}
