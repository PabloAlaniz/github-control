import React from 'react';
import { cn } from '../../../lib/utils';
import { HelpCircle } from 'lucide-react';

export function Icon({ icon: IconComponent = HelpCircle, className, size = 16, ...props }) {
    return (
        <IconComponent
            className={cn(className)}
            size={size}
            {...props}
        />
    );
}
