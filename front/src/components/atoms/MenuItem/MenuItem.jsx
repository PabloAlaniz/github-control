import React from 'react';
import { cn } from '../../../lib/utils';

export function MenuItem({ icon: Icon, children, onClick, variant = 'default', className, ...props }) {
    return (
        <button
            className={cn(
                'text-left px-4 py-2 hover:bg-gray-50 text-sm flex items-center gap-2 w-full',
                variant === 'danger' ? 'text-red-600 hover:bg-red-50' : 'text-gray-700',
                className
            )}
            onClick={onClick}
            {...props}
        >
            {Icon && <Icon size={14} />}
            {children}
        </button>
    );
}
