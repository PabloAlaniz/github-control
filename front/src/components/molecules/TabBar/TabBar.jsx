import React from 'react';
import { cn } from '../../../lib/utils';

export function TabBar({ tabs, activeTab, onTabChange, className }) {
    return (
        <div className={cn("flex bg-gray-100 rounded-lg p-1 gap-1", className)}>
            {tabs.map(({ id, label, icon: Icon, disabled, badge }) => {
                const isActive = activeTab === id;
                return (
                    <button
                        key={id}
                        onClick={() => !disabled && onTabChange(id)}
                        disabled={disabled}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200",
                            isActive
                                ? "bg-white text-blue-700 shadow-sm"
                                : disabled
                                    ? "text-gray-400 cursor-not-allowed"
                                    : "text-gray-500 hover:text-gray-700 cursor-pointer"
                        )}
                    >
                        {Icon && <Icon size={14} />}
                        {label}
                        {badge && (
                            <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-normal">
                                {badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
