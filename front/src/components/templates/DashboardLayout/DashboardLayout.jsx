import React from 'react';
import { cn } from '../../../lib/utils';

export function DashboardLayout({
    sidebar,
    stats,
    children,
    className
}) {
    return (
        <div className={cn("flex h-screen bg-gray-50", className)}>
            {sidebar && (
                <aside className="w-72 flex-shrink-0 hidden md:block">
                    {sidebar}
                </aside>
            )}

            <main className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                    {stats && (
                        <section className="animate-in slide-in-from-top-4 duration-500">
                            {stats}
                        </section>
                    )}

                    <section className="min-h-[500px] animate-in slide-in-from-top-8 duration-700 delay-100">
                        {children}
                    </section>
                </div>
            </main>
        </div>
    );
}
