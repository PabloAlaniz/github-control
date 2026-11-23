import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { fuzzyFilter } from '../../../lib/fuzzy';

const MAX_RESULTS = 50;

/**
 * Command palette. Each command: { id, label, hint?, section, icon?, keywords?, run, runAlt? }.
 * Enter runs `run`; Shift+Enter runs `runAlt` if it exists.
 */
export function CommandPalette({ open, onClose, commands = [] }) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const listRef = useRef(null);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
        }
    }, [open]);

    const results = useMemo(
        () => fuzzyFilter(commands, query, c => [c.label, ...(c.keywords || [])]).slice(0, MAX_RESULTS),
        [commands, query]
    );

    useEffect(() => { setActive(0); }, [query]);

    useEffect(() => {
        const el = listRef.current?.querySelector('[aria-selected="true"]');
        el?.scrollIntoView?.({ block: 'nearest' });
    }, [active, results]);

    if (!open) return null;

    function execute(command, alt = false) {
        if (!command) return;
        onClose();
        (alt && command.runAlt ? command.runAlt : command.run)();
    }

    function onKeyDown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(i => (results.length ? (i + 1) % results.length : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => (results.length ? (i - 1 + results.length) % results.length : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            execute(results[active], e.shiftKey);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    }

    let lastSection = null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/40 pt-[12vh] px-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
                className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
            >
                <div className="flex items-center gap-3 px-4 border-b border-gray-100">
                    <Search size={16} className="text-gray-400 flex-shrink-0" />
                    <input
                        autoFocus
                        role="combobox"
                        aria-expanded="true"
                        aria-controls="command-palette-list"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="Jump to a repo, group, view or action..."
                        className="w-full py-3.5 text-sm bg-transparent outline-none placeholder:text-gray-400"
                    />
                </div>

                <ul id="command-palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
                    {results.length === 0 && (
                        <li className="px-4 py-6 text-center text-sm text-gray-400">No matches</li>
                    )}
                    {results.map((command, i) => {
                        const Icon = command.icon;
                        const showSection = command.section !== lastSection;
                        lastSection = command.section;
                        return (
                            <React.Fragment key={command.id}>
                                {showSection && (
                                    <li role="presentation" className="px-4 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                        {command.section}
                                    </li>
                                )}
                                <li
                                    role="option"
                                    aria-selected={i === active}
                                    onMouseMove={() => setActive(i)}
                                    onClick={(e) => execute(command, e.shiftKey)}
                                    className={cn(
                                        'mx-1 px-3 py-2 rounded-lg flex items-center gap-3 text-sm cursor-pointer',
                                        i === active ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                                    )}
                                >
                                    {Icon && <Icon size={14} className="flex-shrink-0 opacity-70" />}
                                    <span className="truncate">{command.label}</span>
                                    {command.hint && <span className="ml-auto text-xs text-gray-400 flex-shrink-0">{command.hint}</span>}
                                </li>
                            </React.Fragment>
                        );
                    })}
                </ul>

                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500">
                    <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                    <span><kbd className="font-mono">↵</kbd> run</span>
                    <span><kbd className="font-mono">⇧↵</kbd> open on GitHub</span>
                    <span><kbd className="font-mono">esc</kbd> close</span>
                    <span className="ml-auto">Table: <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> move · <kbd className="font-mono">x</kbd> select · <kbd className="font-mono">o</kbd> expand</span>
                </div>
            </div>
        </div>
    );
}
