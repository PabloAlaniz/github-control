import { useEffect, useRef } from 'react';
import { cn } from '../../../lib/utils';

export function Checkbox({ label, checked, indeterminate = false, onChange, className, ...rest }) {
    const inputRef = useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.indeterminate = !!indeterminate;
        }
    }, [indeterminate]);

    const input = (
        <input
            ref={inputRef}
            type="checkbox"
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={!!checked}
            onChange={onChange}
            {...rest}
        />
    );

    if (!label) return input;

    return (
        <label className={cn("flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none", className)}>
            {input}
            {label}
        </label>
    );
}
