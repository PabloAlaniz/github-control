import React from 'react';
import { cn } from '../../../lib/utils';
import { User, Bot } from 'lucide-react';

/** Agents get a color derived from their name, so each one is recognizable at a glance. */
const AGENT_PALETTE = [
    'bg-pink-100 text-pink-800 border-pink-200',
    'bg-purple-100 text-purple-800 border-purple-200',
    'bg-blue-100 text-blue-800 border-blue-200',
    'bg-green-100 text-green-800 border-green-200',
    'bg-amber-100 text-amber-800 border-amber-200',
    'bg-teal-100 text-teal-800 border-teal-200',
    'bg-indigo-100 text-indigo-800 border-indigo-200',
];
const HUMAN_COLOR = 'bg-gray-100 text-gray-800 border-gray-200';
const UNKNOWN_COLOR = 'bg-gray-50 text-gray-600 border-gray-200';

export function actorColor(actorType, actorName) {
    if (actorType === 'human') return HUMAN_COLOR;
    if (actorType !== 'agent') return UNKNOWN_COLOR;
    const name = (actorName || '').toLowerCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AGENT_PALETTE[hash % AGENT_PALETTE.length];
}

export function ActivityBadge({ actorType, actorName, className }) {
    const Icon = actorType === 'agent' ? Bot : User;

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                actorColor(actorType, actorName),
                className
            )}
        >
            <Icon size={12} />
            {actorName || actorType}
        </span>
    );
}
