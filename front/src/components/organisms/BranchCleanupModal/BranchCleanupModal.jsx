import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, GitBranch, Loader2 } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { Checkbox } from '../../atoms/Checkbox';
import { apiFetch } from '../../../lib/api';
import { daysSince } from '../../../lib/signals';
import { cn } from '../../../lib/utils';

const REASONS = {
    default: 'default branch',
    protected: 'protected',
    moved: 'has new commits since it was listed',
    gone: 'already deleted',
    error: 'GitHub error',
};

const STATUS_STYLE = {
    merged: 'bg-green-50 text-green-700 border-green-200',
    stale: 'bg-amber-50 text-amber-700 border-amber-200',
};

/**
 * Branch cleanup for a repo. Lists the merged branches (checked by default)
 * and the abandoned ones (unchecked); deletion asks for confirmation and the
 * back re-verifies each branch before deleting it.
 */
export function BranchCleanupModal({ repo, onClose, onDone }) {
    const [branches, setBranches] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [results, setResults] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch(`/api/repos/${repo.fullName}/signals`);
                if (!res.ok) throw new Error('Could not load branches');
                const data = await res.json();
                if (cancelled) return;
                const items = (data.signals?.branches?.items || []).filter(b => b.status !== 'active');
                setBranches(items);
                setSelected(new Set(items.filter(b => b.status === 'merged').map(b => b.name)));
            } catch (err) {
                if (!cancelled) setError(err.message);
            }
        })();
        return () => { cancelled = true; };
    }, [repo.fullName]);

    const toggle = (name) => {
        setConfirming(false);
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    };

    const targets = useMemo(
        () => (branches || []).filter(b => selected.has(b.name)).map(b => ({ name: b.name, sha: b.sha })),
        [branches, selected]
    );

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const res = await apiFetch(`/api/repos/${repo.fullName}/branches/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Actor-Name': 'user', 'X-Actor-Type': 'human' },
                body: JSON.stringify({ branches: targets }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Delete failed');
            setResults(data.results);
            toast.success(`Deleted ${data.deleted} of ${targets.length} branches`);
            onDone?.();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setDeleting(false);
            setConfirming(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-label="Clean up branches">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        <GitBranch size={20} className="text-gray-600" />
                        <div>
                            <Text variant="h3">Clean up branches</Text>
                            <Text variant="muted" className="text-xs">{repo.fullName}</Text>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-gray-600 h-8 w-8" aria-label="Close">
                        <X size={20} />
                    </Button>
                </div>

                <div className="p-5 overflow-y-auto flex-1">
                    {error && <Text className="text-red-600 text-sm">{error}</Text>}
                    {!error && branches === null && <Text variant="muted">Loading branches...</Text>}
                    {branches?.length === 0 && (
                        <Text variant="muted">Nothing to clean up: no merged or stale branches. Sync signals to refresh.</Text>
                    )}

                    {results ? (
                        <ul className="space-y-1.5 text-sm">
                            {results.map(r => (
                                <li key={r.name} className="flex items-baseline gap-2">
                                    <span className={r.deleted ? 'text-green-600' : 'text-amber-600'}>{r.deleted ? 'deleted' : 'skipped'}</span>
                                    <span className="font-mono text-gray-800 break-all">{r.name}</span>
                                    {!r.deleted && <span className="text-gray-500">— {REASONS[r.reason] || r.reason}{r.error ? `: ${r.error}` : ''}</span>}
                                </li>
                            ))}
                        </ul>
                    ) : branches?.length > 0 && (
                        <ul className="divide-y divide-gray-100">
                            {branches.map(b => {
                                const age = daysSince(b.lastCommitAt);
                                return (
                                    <li key={b.name} className="py-2 flex items-start gap-3">
                                        <Checkbox
                                            checked={selected.has(b.name)}
                                            onChange={() => toggle(b.name)}
                                            aria-label={`Select branch ${b.name}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-mono text-sm text-gray-900 break-all">{b.name}</span>
                                                <span className={cn('rounded border px-1.5 text-[10px] font-medium', STATUS_STYLE[b.status])}>{b.status}</span>
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {b.mergedVia === 'pr' && b.pr && (
                                                    <>merged in <a href={b.pr.url} target="_blank" rel="noopener noreferrer" className="hover:underline">#{b.pr.number}</a> · </>
                                                )}
                                                {b.mergedVia === 'ancestor' && 'no commits of its own · '}
                                                {b.status === 'stale' && b.ahead > 0 && `${b.ahead} unmerged commits · `}
                                                {age === null ? 'last commit unknown' : `last commit ${age}d ago`}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-200">
                    <Text variant="muted" className="text-xs">
                        {results ? 'Done.' : 'Stale branches may hold unmerged work: they are not selected by default.'}
                    </Text>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
                        {!results && (
                            confirming ? (
                                <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white gap-2">
                                    {deleting && <Loader2 size={14} className="animate-spin" />}
                                    Confirm: delete {targets.length} on GitHub
                                </Button>
                            ) : (
                                <Button onClick={() => setConfirming(true)} disabled={targets.length === 0} variant="outline" className="text-red-600 border-red-200">
                                    Delete {targets.length} branches
                                </Button>
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
