import React from 'react';
import { cn } from '../../../lib/utils';

const sizes = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-3 h-3',
};

export function ColorDot({ color, size = 'md', className, ...props }) {
    return (
        <span
            className={cn('rounded-full inline-block flex-shrink-0', sizes[size], className)}
            style={{ backgroundColor: color }}
            {...props}
        />
    );
}
