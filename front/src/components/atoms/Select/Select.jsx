import React from 'react';
import { cn } from '../../../lib/utils';
import { ChevronDown } from 'lucide-react';

export function Select({ className, children, ...props }) {
    return (
        <div className="relative">
            <select
                className={cn(
                    'appearance-none flex h-10 w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pr-8',
                    className
                )}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
        </div>
    );
}
