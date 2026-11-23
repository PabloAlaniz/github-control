import React from 'react';
import { cn } from '../../../lib/utils';

export function ExternalLink({ href, children, className, ...props }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(className)}
            {...props}
        >
            {children}
        </a>
    );
}
