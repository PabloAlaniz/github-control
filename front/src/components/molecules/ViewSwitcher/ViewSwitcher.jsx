import React from 'react';
import { cn } from '../../../lib/utils';
import { GitBranch, Server } from 'lucide-react';

const VIEWS = [
    { id: 'repos', label: 'Repos', icon: GitBranch },
    { id: 'services', label: 'Services', icon: Server },
];

export function ViewSwitcher({ activeView, onViewChange, className }) {
    return (
        <div className={cn("flex bg-gray-100 rounded-lg p-1 gap-1", className)}>
            {VIEWS.map(({ id, label, icon: Icon }) => {
                const isActive = activeView === id;
                return (
                    <button
                        key={id}
                        onClick={() => onViewChange(id)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                            isActive
                                ? "bg-white text-blue-700 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        <Icon size={14} />
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
