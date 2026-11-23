import React from 'react';
import { cn } from '../../../lib/utils';

export function Button({
    className,
    variant = 'primary',
    size = 'md',
    children,
    ...props
}) {
    const variants = {
        primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md',
        secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:text-gray-900 shadow-sm',
        ghost: 'bg-transparent text-gray-600 hover:bg-gray-100/50 hover:text-gray-900',
        danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200',
        outline: 'bg-transparent border border-gray-300 text-gray-700 hover:bg-gray-50',
    };

    const sizes = {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 py-2 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10 p-2 flex items-center justify-center',
    };

    return (
        <button
            className={cn(
                'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-95',
                variants[variant],
                sizes[size],
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
}
