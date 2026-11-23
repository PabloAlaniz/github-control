import React from 'react';
import { cn } from '../../../lib/utils';

export function Text({
    className,
    variant = 'p',
    as,
    children,
    ...props
}) {
    const Component = as || (variant === 'h1' || variant === 'h2' || variant === 'h3' ? variant : 'p');

    const variants = {
        h1: 'text-3xl font-bold tracking-tight text-gray-900',
        h2: 'text-2xl font-semibold tracking-tight text-gray-900',
        h3: 'text-xl font-semibold tracking-tight text-gray-900',
        p: 'text-sm text-gray-700',
        muted: 'text-sm text-gray-500',
        small: 'text-xs text-gray-500 font-medium',
        large: 'text-lg font-semibold text-gray-900',
    };

    return (
        <Component
            className={cn(variants[variant], className)}
            {...props}
        >
            {children}
        </Component>
    );
}
