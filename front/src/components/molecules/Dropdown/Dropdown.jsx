import React from 'react';
import { cn } from '../../../lib/utils';

const positions = {
    'bottom-right': 'right-0 bottom-full mb-2 origin-bottom-right',
    'bottom-left': 'left-0 bottom-full mb-2 origin-bottom-left',
    'top-right': 'right-0 top-full mt-2 origin-top-right',
    'top-left': 'left-0 top-full mt-2 origin-top-left',
};

export function Dropdown({ open, onClose, children, className, position = 'bottom-right' }) {
    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-10" onClick={onClose} />
            <div
                className={cn(
                    'absolute w-48 bg-white rounded-lg shadow-xl border border-gray-100 z-20 py-1 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200',
                    positions[position],
                    className
                )}
            >
                {children}
            </div>
        </>
    );
}
