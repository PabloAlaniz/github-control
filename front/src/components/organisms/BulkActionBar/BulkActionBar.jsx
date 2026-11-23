import { useState } from 'react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { Archive, Tag, Flag, X, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { ColorDot } from '../../atoms/ColorDot';
import { cn } from '../../../lib/utils';

const PRIORITIES = [
    { value: 'high',   label: 'High',   color: 'text-red-600' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-600' },
    { value: 'low',    label: 'Low',    color: 'text-blue-600' },
    { value: 'paused', label: 'Paused', color: 'text-gray-500' },
    { value: null,     label: 'Clear',  color: 'text-gray-400' },
];

function MenuPopover({ open, onClose, children }) {
    if (!open) return null;
    return (
        <>
            <div className="fixed inset-0 z-40" onClick={onClose} />
            <div className="absolute bottom-full right-0 mb-2 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {children}
            </div>
        </>
    );
}

export function BulkActionBar({
    count,
    onArchive,
    onSetPriority,
    onAddToGroup,
    onSyncSignals,
    onApplyBaseline,
    baselineCount = 0,
    onClear,
    groups = [],
    busy = false,
}) {
    const [openMenu, setOpenMenu] = useState(null);  // 'priority' | 'group' | null

    if (count === 0) return null;

    const close = () => setOpenMenu(null);

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-2xl animate-in slide-in-from-bottom-2">
            <Text variant="small" className="px-2 font-medium text-gray-700 whitespace-nowrap">
                {count} selected
            </Text>

            <div className="h-5 w-px bg-gray-200" />

            <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                    if (confirm(`Archive ${count} repos? This will archive them on GitHub as well.`)) {
                        onArchive();
                    }
                }}
                disabled={busy}
                className="gap-1.5"
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                Archive
            </Button>

            {onSyncSignals && (
                <Button variant="ghost" size="sm" onClick={onSyncSignals} disabled={busy} className="gap-1.5" title="Fetch standards and other signals from GitHub">
                    <RefreshCw size={14} />
                    Sync signals
                </Button>
            )}

            {onApplyBaseline && baselineCount > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        if (confirm(`Apply the settings baseline to ${baselineCount} repos? This changes their settings on GitHub.`)) {
                            onApplyBaseline();
                        }
                    }}
                    disabled={busy}
                    className="gap-1.5"
                    title="Change repo settings on GitHub to match the baseline"
                >
                    <Settings2 size={14} />
                    Apply baseline ({baselineCount})
                </Button>
            )}

            <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setOpenMenu(openMenu === 'priority' ? null : 'priority')} disabled={busy} className="gap-1.5">
                    <Flag size={14} />
                    Priority
                </Button>
                <MenuPopover open={openMenu === 'priority'} onClose={close}>
                    {PRIORITIES.map(p => (
                        <button
                            key={p.value ?? 'clear'}
                            className={cn('w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2', p.color)}
                            onClick={() => { close(); onSetPriority(p.value); }}
                        >
                            <Flag size={12} /> {p.label}
                        </button>
                    ))}
                </MenuPopover>
            </div>

            <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setOpenMenu(openMenu === 'group' ? null : 'group')} disabled={busy} className="gap-1.5">
                    <Tag size={14} />
                    Group
                </Button>
                <MenuPopover open={openMenu === 'group'} onClose={close}>
                    {groups.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400 italic">No groups available</div>
                    )}
                    {groups.map(g => (
                        <button
                            key={g.id}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                            onClick={() => { close(); onAddToGroup(g); }}
                        >
                            <ColorDot color={g.color} size="sm" />
                            {g.name}
                        </button>
                    ))}
                </MenuPopover>
            </div>

            <div className="h-5 w-px bg-gray-200" />

            <Button variant="ghost" size="sm" onClick={onClear} disabled={busy} className="gap-1 text-gray-500 hover:text-gray-900">
                <X size={14} />
                Clear
            </Button>
        </div>
    );
}
