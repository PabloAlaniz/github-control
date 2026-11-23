import React, { useState } from 'react';
import { Bookmark, Plus, X, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { Input } from '../../atoms/Input';
import { Text } from '../../atoms/Text';
import { cn } from '../../../lib/utils';
import { normalizeViewQuery } from '../../../lib/viewState';

/**
 * List of saved views (named tab + filters).
 * `currentQuery` is the query string of the current view; a saved view is
 * marked active when its query matches.
 */
export function SavedViews({ views = [], currentQuery = '', onApply, onSave, onDelete, onReset }) {
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const isDefault = currentQuery === '';

    async function handleSubmit(e) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const ok = await onSave(trimmed, currentQuery);
        if (ok !== false) {
            setName('');
            setShowForm(false);
        }
    }

    return (
        <div className="space-y-1 pb-2">
            <div className="flex items-center justify-between px-3 py-1">
                <Text variant="small" className="text-gray-400 font-medium uppercase tracking-wider text-[10px]">
                    Views
                </Text>
                <div className="flex items-center gap-1">
                    {!isDefault && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onReset}
                            className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                            title="Reset filters"
                        >
                            <RotateCcw size={12} />
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowForm(!showForm)}
                        className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                        title="Save current view"
                    >
                        {showForm ? <X size={12} /> : <Plus size={12} />}
                    </Button>
                </div>
            </div>

            {showForm && (
                <form className="p-3 mx-2 mb-2 bg-gray-50 rounded-lg border border-gray-100 space-y-2" onSubmit={handleSubmit}>
                    <Input
                        type="text"
                        placeholder="View name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        autoFocus
                        className="bg-white"
                    />
                    <Button type="submit" size="sm" className="w-full" disabled={!name.trim()}>
                        Save current filters
                    </Button>
                </form>
            )}

            <div className="space-y-0.5 px-2">
                {views.map(view => {
                    const active = normalizeViewQuery(view.query) === currentQuery;
                    return (
                        <div key={view.id} className="relative group/view">
                            <button
                                className={cn(
                                    'w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent',
                                    active && 'bg-blue-50 border-blue-100 text-blue-700 shadow-sm'
                                )}
                                onClick={() => onApply(view)}
                                aria-current={active ? 'true' : undefined}
                            >
                                <Bookmark size={14} className={active ? 'text-blue-600' : 'text-gray-400'} />
                                <span className="font-medium text-sm truncate pr-6">{view.name}</span>
                            </button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 h-auto w-auto text-gray-400 hover:text-red-500 rounded opacity-0 group-hover/view:opacity-100 focus:opacity-100 transition-opacity"
                                onClick={() => {
                                    if (confirm(`Delete view "${view.name}"?`)) onDelete(view.id);
                                }}
                                title="Delete view"
                            >
                                <Trash2 size={14} />
                            </Button>
                        </div>
                    );
                })}
                {views.length === 0 && !showForm && (
                    <div className="px-1 py-2">
                        <Text variant="small" className="text-gray-400 italic">
                            No saved views yet
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
}
