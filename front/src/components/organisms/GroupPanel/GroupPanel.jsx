import React, { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Input } from '../../atoms/Input';
import { Text } from '../../atoms/Text';
import { Card } from '../../atoms/Card';
import { ColorDot } from '../../atoms/ColorDot';
import { cn } from '../../../lib/utils';
import { Plus, X, Folder, Layers, GripVertical, Trash2 } from 'lucide-react';

export function GroupPanel({
    groups,
    repos,
    onCreateGroup,
    onDeleteGroup,
    selectedGroup,
    onSelectGroup,
    onAddToGroup
}) {
    const [showForm, setShowForm] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDesc, setNewGroupDesc] = useState('');
    const [newGroupColor, setNewGroupColor] = useState('#6366f1');
    const [dragOverGroup, setDragOverGroup] = useState(null);

    function handleDragOver(e, groupId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOverGroup(groupId);
    }

    function handleDragLeave() {
        setDragOverGroup(null);
    }

    function handleDrop(e, groupId) {
        e.preventDefault();
        const repoFullName = e.dataTransfer.getData('text/plain');
        if (repoFullName && onAddToGroup) {
            onAddToGroup(groupId, repoFullName);
        }
        setDragOverGroup(null);
    }

    const colors = [
        '#ef4444', '#f97316', '#eab308', '#22c55e',
        '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'
    ];

    function handleSubmit(e) {
        e.preventDefault();
        if (newGroupName.trim()) {
            onCreateGroup(newGroupName.trim(), newGroupDesc.trim(), newGroupColor);
            setNewGroupName('');
            setNewGroupDesc('');
            setShowForm(false);
        }
    }

    return (
        <Card className="h-full flex flex-col bg-white border-r border-gray-200 rounded-none h-[calc(100vh-64px)] overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <Text variant="h3" className="text-base font-semibold">Groups</Text>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowForm(!showForm)}
                    className="h-8 w-8 p-0 rounded-full hover:bg-gray-100"
                    title="Create New Group"
                >
                    {showForm ? <X size={16} /> : <Plus size={16} />}
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {showForm && (
                    <form className="p-3 mb-2 bg-gray-50 rounded-lg border border-gray-100 space-y-2 animate-in slide-in-from-top-2" onSubmit={handleSubmit}>
                        <Input
                            type="text"
                            placeholder="Group name"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            autoFocus
                            className="bg-white"
                        />
                        <Input
                            type="text"
                            placeholder="Description (optional)"
                            value={newGroupDesc}
                            onChange={(e) => setNewGroupDesc(e.target.value)}
                            className="bg-white"
                        />
                        <div className="flex flex-wrap gap-1.5 pt-1">
                            {colors.map(color => (
                                <Button
                                    key={color}
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        "w-5 h-5 rounded-full transition-transform hover:scale-110 ring-2 ring-offset-1 ring-transparent focus:ring-gray-400 p-0",
                                        color === newGroupColor && "ring-gray-400 scale-110"
                                    )}
                                    style={{ backgroundColor: color }}
                                    onClick={() => setNewGroupColor(color)}
                                />
                            ))}
                        </div>
                        <Button type="submit" size="sm" className="w-full mt-2">Create Group</Button>
                    </form>
                )}

                <button
                    className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                        selectedGroup === 'all' && "bg-blue-50 border-blue-100 text-blue-700 shadow-sm"
                    )}
                    onClick={() => onSelectGroup('all')}
                >
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-md bg-gray-100 text-gray-500">
                            <Layers size={16} />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-sm">All Repos</span>
                            <span className="text-xs opacity-70">Everything</span>
                        </div>
                    </div>
                    <span className="text-xs font-semibold bg-gray-200/50 px-2 py-0.5 rounded-full text-gray-600">
                        {repos.length}
                    </span>
                </button>

                <button
                    className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                        selectedGroup === 'ungrouped' && "bg-blue-50 border-blue-100 text-blue-700 shadow-sm"
                    )}
                    onClick={() => onSelectGroup('ungrouped')}
                >
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-md bg-gray-100 text-gray-500">
                            <Folder size={16} />
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-sm">Ungrouped</span>
                            <span className="text-xs opacity-70">Uncategorized</span>
                        </div>
                    </div>
                    <span className="text-xs font-semibold bg-gray-200/50 px-2 py-0.5 rounded-full text-gray-600">
                        {repos.filter(r => !r.groups || r.groups.length === 0).length}
                    </span>
                </button>

                <div className="h-px bg-gray-100 my-2 mx-2" />

                <div className="space-y-1">
                    <Text variant="small" className="px-3 py-1 text-gray-400 font-medium uppercase tracking-wider text-[10px]">
                        Custom Groups
                    </Text>

                    {groups.map(group => {
                        const repoCount = repos.filter(r => r.groups?.includes(group.slug)).length;
                        const isSelected = selectedGroup === group.slug;
                        const isDragOver = dragOverGroup === group.id;

                        return (
                            <div
                                key={group.id}
                                className="relative group/item"
                                onDragOver={(e) => handleDragOver(e, group.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, group.id)}
                            >
                                <button
                                    className={cn(
                                        "w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all duration-200 hover:bg-gray-50 border border-transparent",
                                        isSelected && "bg-blue-50 border-blue-100 text-blue-700 shadow-sm",
                                        isDragOver && "bg-blue-50 border-blue-300 ring-2 ring-blue-200 z-10 scale-[1.02]"
                                    )}
                                    onClick={() => onSelectGroup(group.slug)}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <ColorDot color={group.color} size="md" />
                                        <span className="font-medium text-sm truncate">{group.name}</span>
                                    </div>
                                    <span className={cn(
                                        "text-xs font-semibold px-2 py-0.5 rounded-full text-gray-600",
                                        isSelected ? "bg-white/50" : "bg-gray-100"
                                    )}>
                                        {repoCount}
                                    </span>
                                </button>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-12 top-1/2 -translate-y-1/2 p-1.5 h-auto w-auto text-gray-400 hover:text-red-500 rounded opacity-0 group-hover/item:opacity-100 transition-opacity"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Are you sure you want to delete this group?')) {
                                            onDeleteGroup(group.id);
                                        }
                                    }}
                                    title="Delete group"
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        );
                    })}
                    {groups.length === 0 && (
                        <div className="px-3 py-4 text-center">
                            <Text variant="small" className="text-gray-400 italic">No custom groups yet</Text>
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}
