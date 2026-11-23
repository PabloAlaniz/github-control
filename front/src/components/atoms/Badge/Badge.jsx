import React from 'react';
import { cn } from '../../../lib/utils';

export function Badge({
    className,
    variant = 'default',
    children,
    ...props
}) {
    const variants = {
        default: 'bg-gray-100 text-gray-800',
        primary: 'bg-blue-100 text-blue-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-yellow-100 text-yellow-800',
        danger: 'bg-red-100 text-red-800',
        outline: 'text-gray-950 border border-gray-200',
    };

    return (
        <div
            className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-gray-950 focus:ring-offset-2',
                variants[variant],
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
