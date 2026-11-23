import React from 'react';
import { Input } from '../../atoms/Input';
import { Icon } from '../../atoms/Icon';
import { Search } from 'lucide-react';
import { cn } from '../../../lib/utils';

export function SearchInput({
    className,
    placeholder = "Search...",
    value,
    onChange,
    ...props
}) {
    return (
        <div className={cn("relative", className)}>
            <Icon
                icon={Search}
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <Input
                value={value}
                onChange={onChange}
                className="pl-9"
                placeholder={placeholder}
                {...props}
            />
        </div>
    );
}
