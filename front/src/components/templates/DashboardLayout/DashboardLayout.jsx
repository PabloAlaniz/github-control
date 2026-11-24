import React, { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * A page inside the app shell: an optional side panel (filters, sections), a
 * header area (`stats`) and the content. The side panel is a column on wide
 * screens and slides over the content on narrow ones.
 */
export function DashboardLayout({
    sidebar,
    stats,
    children,
    className
}) {
    const [panelOpen, setPanelOpen] = useState(false);

    return (
        <div className={cn("relative flex h-full min-h-0 bg-gray-50", className)}>
            {sidebar && (
                <>
                    <aside className="w-72 flex-shrink-0 hidden md:block">
                        {sidebar}
                    </aside>
                    {panelOpen && (
                        <div className="absolute inset-0 z-30 flex md:hidden">
                            <aside className="w-72 max-w-[85vw] overflow-y-auto bg-white shadow-xl">{sidebar}</aside>
                            <button type="button" aria-label="Close filters" className="flex-1 bg-black/40" onClick={() => setPanelOpen(false)} />
                        </div>
                    )}
                </>
            )}

            <main className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
                    {sidebar && (
                        <button
                            type="button" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 md:hidden"
                        >
                            {panelOpen ? <X size={14} /> : <SlidersHorizontal size={14} />}
                            Filters
                        </button>
                    )}
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
