import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Bookmark, CircleDot, GitMerge, GitPullRequest, Loader2, MessageSquare, Plus, RefreshCw, Trash2, X,
} from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { Select } from '../components/atoms/Select';
import { Checkbox } from '../components/atoms/Checkbox';
import { SearchInput } from '../components/molecules/SearchInput';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';
import { formatTimeAgo } from '../lib/formatters';
import { useHotkeys } from '../hooks/useHotkeys';
import { useSavedViews } from '../hooks/useSavedViews';
import { writeViewQueryToUrl } from '../lib/viewState';
import { cn } from '../lib/utils';
import {
    DEFAULT_INBOX_FILTERS, MERGE_SKIP_REASONS, availableSections, filterInbox, groupByRepo, inboxViewQuery,
    isInboxView, isMergeable, itemKey, parseInboxFilters, resolveSection, sectionCounts, serializeInboxFilters,
} from '../lib/inbox';

const MERGE_METHODS = [['squash', 'Squash and merge'], ['merge', 'Merge commit'], ['rebase', 'Rebase and merge']];

async function readJson(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

/** Black or white, whichever reads better on a label's color. */
function labelStyle(color) {
    if (!/^[0-9a-f]{6}$/i.test(color ?? '')) return undefined;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(color.slice(i, i + 2), 16));
    const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
    return { backgroundColor: `#${color}`, color: light ? '#111827' : '#ffffff' };
}

function ItemRow({ item, active, selected, onToggle, showRepo }) {
    const Icon = item.type === 'pr' ? GitPullRequest : CircleDot;
    return (
        <li
            data-active={active || undefined}
            className={cn('flex items-start gap-3 px-4 py-2.5', active && 'bg-blue-50 ring-1 ring-inset ring-blue-200')}
        >
            <div className="flex h-5 w-4 flex-shrink-0 items-center">
                {isMergeable(item) && (
                    <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${item.repo}#${item.number}`} />
                )}
            </div>
            <Icon size={16} className={cn('mt-0.5 flex-shrink-0', item.draft ? 'text-gray-400' : 'text-green-600')} aria-label={item.type === 'pr' ? 'Pull request' : 'Issue'} />
            <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{item.title}</a>
                    {item.draft && <span className="ml-2 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">Draft</span>}
                    {item.labels.map((label) => (
                        <span key={label.name} style={labelStyle(label.color)}
                            className="ml-1.5 inline-block rounded-full bg-gray-100 px-2 py-0.5 align-middle text-[10px] font-medium text-gray-700">
                            {label.name}
                        </span>
                    ))}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                    {showRepo && <span className="text-gray-700">{item.repo} </span>}
                    #{item.number}
                    {item.author && <> by {item.author}</>}
                    {item.requestedReviewers.length > 0 && <> · review: {item.requestedReviewers.join(', ')}</>}
                    {item.assignees.length > 0 && <> · assigned: {item.assignees.join(', ')}</>}
                </p>
            </div>
            {item.comments > 0 && (
                <span className="flex flex-shrink-0 items-center gap-1 text-xs text-gray-400" title={`${item.comments} comments`}>
                    <MessageSquare size={12} />{item.comments}
                </span>
            )}
            <span className="w-24 flex-shrink-0 text-right text-xs text-gray-400" title={item.updatedAt}>{formatTimeAgo(item.updatedAt)}</span>
        </li>
    );
}

function MergeModal({ items, onClose, onDone }) {
    const [method, setMethod] = useState('squash');
    const [merging, setMerging] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState('');

    const merge = async () => {
        setMerging(true);
        setError('');
        try {
            const body = await readJson(await apiFetch('/api/inbox/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method, pulls: items.map((item) => ({ repo: item.repo, number: item.number, sha: item.headSha })) }),
            }));
            setResults(body.results);
            onDone();
        } catch (err) {
            setError(err.message);
        } finally {
            setMerging(false);
        }
    };

    const titleOf = (result) => items.find((item) => item.repo === result.repo && item.number === result.number)?.title ?? '';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-label="Merge pull requests">
            <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 p-5">
                    <div className="flex items-center gap-3">
                        <GitMerge size={20} className="text-gray-600" />
                        <Text variant="h3">Merge {items.length} pull request{items.length === 1 ? '' : 's'}</Text>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-gray-400 hover:text-gray-600" aria-label="Close">
                        <X size={20} />
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
                    <ul className="space-y-1.5 text-sm">
                        {results ? results.map((result) => (
                            <li key={`${result.repo}#${result.number}`} className="flex items-baseline gap-2">
                                <span className={result.merged ? 'text-green-600' : 'text-amber-600'}>{result.merged ? 'merged' : 'skipped'}</span>
                                <span className="text-gray-800">{result.repo}#{result.number} {titleOf(result)}</span>
                                {!result.merged && (
                                    <span className="text-gray-500">— {MERGE_SKIP_REASONS[result.reason] || result.reason}{result.error ? `: ${result.error}` : ''}</span>
                                )}
                            </li>
                        )) : items.map((item) => (
                            <li key={itemKey(item)} className="flex items-baseline gap-2">
                                <span className="flex-shrink-0 text-gray-500">{item.repo}#{item.number}</span>
                                <span className="text-gray-900">{item.title}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-5">
                    {results ? (
                        <Text variant="muted" className="text-xs">Done.</Text>
                    ) : (
                        <div className="flex items-center gap-3">
                            <div className="w-56 flex-shrink-0">
                                <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Merge method">
                                    {MERGE_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </Select>
                            </div>
                            <Text variant="muted" className="text-xs">Skipped if checks fail or are running, or if it changed since listed.</Text>
                        </div>
                    )}
                    <div className="flex flex-shrink-0 items-center gap-2">
                        <Button variant="ghost" onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
                        {!results && (
                            <Button onClick={merge} disabled={merging} className="gap-2">
                                {merging && <Loader2 size={14} className="animate-spin" />}
                                Merge on GitHub
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SectionList({ sections, counts, active, onPick, views, activeQuery, onApplyView, onSaveView, onDeleteView }) {
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');

    const save = async (event) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (await onSaveView(name.trim()) !== false) {
            setName('');
            setNaming(false);
        }
    };

    return (
        <nav className="flex h-full flex-col gap-1 overflow-y-auto border-r border-gray-200 bg-white p-3" aria-label="Inbox sections">
            {sections.map((section) => (
                <button
                    key={section.id}
                    type="button"
                    onClick={() => onPick(section.id)}
                    aria-current={active === section.id ? 'true' : undefined}
                    className={cn(
                        'flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors',
                        active === section.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100',
                    )}
                >
                    {section.label}
                    <span className="text-xs tabular-nums text-gray-500">{counts[section.id] ?? 0}</span>
                </button>
            ))}

            <div className="mt-4 flex items-center justify-between px-3 py-1">
                <Text variant="small" className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Saved views</Text>
                <Button size="sm" variant="ghost" onClick={() => setNaming(!naming)} className="h-6 w-6 rounded-full p-0" title="Save the current filters as a view" aria-label="Save view">
                    {naming ? <X size={12} /> : <Plus size={12} />}
                </Button>
            </div>
            {naming && (
                <form onSubmit={save} className="space-y-2 px-2 pb-2">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" maxLength={80} autoFocus aria-label="View name" />
                    <Button type="submit" size="sm" disabled={!name.trim()} className="w-full">Save view</Button>
                </form>
            )}
            {views.length === 0 && !naming && <p className="px-3 text-xs italic text-gray-400">None yet</p>}
            {views.map((view) => (
                <div key={view.id} className={cn('group flex items-center rounded-lg text-sm', view.query === activeQuery ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100')}>
                    <button type="button" onClick={() => onApplyView(view)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
                        <Bookmark size={14} className="flex-shrink-0" />
                        <span className="truncate">{view.name}</span>
                    </button>
                    <button type="button" onClick={() => onDeleteView(view.id)} aria-label={`Delete view ${view.name}`}
                        className="mr-1 rounded p-1 text-gray-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100">
                        <Trash2 size={12} />
                    </button>
                </div>
            ))}
            <p className="mt-auto px-3 pt-4 text-[11px] leading-relaxed text-gray-400">
                <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>x</kbd> select · <kbd>o</kbd> open · <kbd>/</kbd> search
            </p>
        </nav>
    );
}

/** Open pull requests and issues of every repo in one list, with sections, filters and bulk merge. */
export function InboxPage() {
    const navigate = useNavigate();
    const [inbox, setInbox] = useState(null);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [filters, setFilters] = useState(() => parseInboxFilters(typeof window === 'undefined' ? '' : window.location.search));
    const [selected, setSelected] = useState(() => new Set());
    const [activeRow, setActiveRow] = useState(-1);
    const [merging, setMerging] = useState(false);
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const { views, saveView, deleteView } = useSavedViews();

    const load = useCallback(async () => {
        setError(null);
        try {
            setInbox(await readJson(await apiFetch('/api/inbox')));
        } catch (err) {
            setError(err.message);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const refresh = async () => {
        setRefreshing(true);
        try {
            await apiFetch('/api/inbox/refresh', { method: 'POST' });
            await load();
        } finally {
            setRefreshing(false);
        }
    };

    const viewer = inbox?.viewer ?? null;
    const items = inbox?.items ?? [];
    // Without a known viewer the "my" sections cannot work: show the closest one instead.
    const section = inbox ? resolveSection(filters.section, viewer) : filters.section;
    const effective = useMemo(() => ({ ...filters, section }), [filters, section]);
    const context = useMemo(() => ({ viewer, now: Date.now() }), [viewer, inbox]); // eslint-disable-line react-hooks/exhaustive-deps

    const query = serializeInboxFilters(filters);
    useEffect(() => { writeViewQueryToUrl(query); }, [query]);

    const visible = useMemo(() => filterInbox(items, effective, context), [items, effective, context]);
    const counts = useMemo(() => sectionCounts(items, context), [items, context]);
    const inSection = useMemo(() => filterInbox(items, { ...DEFAULT_INBOX_FILTERS, section }, context), [items, section, context]);
    const repos = useMemo(() => [...new Set(inSection.map((item) => item.repo))].sort(), [inSection]);
    const labels = useMemo(() => [...new Set(inSection.flatMap((item) => item.labels.map((label) => label.name)))].sort(), [inSection]);

    const grouped = section === 'deps';
    const groups = useMemo(() => (grouped ? groupByRepo(visible) : [[null, visible]]), [grouped, visible]);
    // Rows in the order they are drawn, so j/k follow what is on screen.
    const ordered = useMemo(() => groups.flatMap(([, rows]) => rows), [groups]);

    const set = (patch) => { setFilters((prev) => ({ ...prev, ...patch })); setActiveRow(-1); };
    const pickSection = (id) => { setFilters({ ...DEFAULT_INBOX_FILTERS, section: id }); setSelected(new Set()); setActiveRow(-1); };

    const toggle = (item) => setSelected((prev) => {
        const next = new Set(prev);
        const key = itemKey(item);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const setMany = (rows, on) => setSelected((prev) => {
        const next = new Set(prev);
        for (const item of rows.filter(isMergeable)) {
            if (on) next.add(itemKey(item)); else next.delete(itemKey(item));
        }
        return next;
    });
    const selectedItems = ordered.filter((item) => selected.has(itemKey(item)));

    const move = (delta) => setActiveRow((i) => Math.min(ordered.length - 1, Math.max(0, i + delta)));
    const activeItem = ordered[activeRow];
    useHotkeys({
        j: () => move(1),
        k: () => move(-1),
        x: () => { if (activeItem && isMergeable(activeItem)) toggle(activeItem); },
        o: () => { if (activeItem) window.open(activeItem.url, '_blank', 'noopener'); },
        enter: () => { if (activeItem) window.open(activeItem.url, '_blank', 'noopener'); },
        '/': () => searchRef.current?.querySelector('input')?.focus(),
        escape: () => { setActiveRow(-1); setSelected(new Set()); },
    }, { enabled: !merging });
    useEffect(() => {
        if (activeRow >= 0) listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [activeRow]);

    if (error) return <ErrorState variant="page" message={error} onRetry={load} />;

    const inboxViews = views.filter(isInboxView);
    const filtered = filters.search || filters.repo !== 'all' || filters.label !== 'all' || filters.hideDrafts;
    const neverSynced = inbox && inbox.reposSynced === 0;

    return (
        <>
            <DashboardLayout
                sidebar={
                    <SectionList
                        sections={availableSections(inbox ? viewer : 'unknown')}
                        counts={counts}
                        active={section}
                        onPick={pickSection}
                        views={inboxViews}
                        activeQuery={inboxViewQuery(filters)}
                        onApplyView={(view) => { setFilters(parseInboxFilters(view.query)); setSelected(new Set()); setActiveRow(-1); }}
                        onSaveView={(name) => saveView(name, inboxViewQuery(filters))}
                        onDeleteView={deleteView}
                    />
                }
                stats={
                    <header className="flex items-center gap-4">
                        <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                            <ArrowLeft size={16} />
                            Back
                        </Button>
                        <div className="flex-1">
                            <Text variant="h2">Inbox</Text>
                            <Text variant="muted">
                                Open pull requests and issues across your repos
                                {viewer && <> · signed in to GitHub as {viewer}</>}
                                {inbox?.oldestCheck && <> · read {formatTimeAgo(inbox.oldestCheck)}</>}
                            </Text>
                        </div>
                        <Button variant="outline" onClick={refresh} disabled={refreshing} className="gap-2" title="Read every repo's pull requests and issues from GitHub again">
                            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                            {refreshing ? 'Refreshing…' : 'Refresh'}
                        </Button>
                    </header>
                }
            >
                {!inbox ? (
                    <Text variant="muted">Loading...</Text>
                ) : neverSynced ? (
                    <Card className="p-8 text-center">
                        <h3 className="text-sm font-semibold text-gray-900">Nothing read yet</h3>
                        <Text variant="muted" className="mt-1">Press Refresh, or wait for the next sync, to read the open pull requests and issues of your repos.</Text>
                    </Card>
                ) : (
                    <Card className="overflow-hidden">
                        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
                            <div ref={searchRef}>
                                <SearchInput placeholder="Search title, repo, author..." value={filters.search} onChange={(e) => set({ search: e.target.value })} className="w-64" />
                            </div>
                            <Select value={repos.includes(filters.repo) ? filters.repo : 'all'} onChange={(e) => set({ repo: e.target.value })} aria-label="Repo" className="w-52">
                                <option value="all">All repos</option>
                                {repos.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
                            </Select>
                            <Select value={labels.includes(filters.label) ? filters.label : 'all'} onChange={(e) => set({ label: e.target.value })} aria-label="Label" className="w-44">
                                <option value="all">All labels</option>
                                {labels.map((label) => <option key={label} value={label}>{label}</option>)}
                            </Select>
                            <Checkbox label="Hide drafts" checked={filters.hideDrafts} onChange={(e) => set({ hideDrafts: e.target.checked })} />
                            <span className="ml-auto text-xs tabular-nums text-gray-500">{visible.length} item{visible.length === 1 ? '' : 's'}</span>
                        </div>

                        {selectedItems.length > 0 && (
                            <div className="flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">
                                {selectedItems.length} selected
                                <Button size="sm" onClick={() => setMerging(true)} className="gap-1.5"><GitMerge size={14} />Merge…</Button>
                                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
                            </div>
                        )}

                        {inbox.truncated.length > 0 && (
                            <p className="border-b border-gray-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                                Only the 100 most recently updated items are kept for: {inbox.truncated.join(', ')}.
                            </p>
                        )}

                        {visible.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-gray-500">
                                {filtered ? 'Nothing matches these filters.' : 'Nothing here. Enjoy the quiet.'}
                            </p>
                        ) : (
                            <div ref={listRef}>
                                {groups.map(([repo, rows]) => {
                                    const mergeable = rows.filter(isMergeable);
                                    const allSelected = mergeable.length > 0 && mergeable.every((item) => selected.has(itemKey(item)));
                                    return (
                                        <section key={repo ?? 'all'}>
                                            {repo && (
                                                <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2">
                                                    <Checkbox checked={allSelected} disabled={mergeable.length === 0}
                                                        onChange={() => setMany(rows, !allSelected)} aria-label={`Select all in ${repo}`} />
                                                    <h3 className="text-xs font-semibold text-gray-700">{repo}</h3>
                                                    <span className="text-xs text-gray-500">{rows.length}</span>
                                                </div>
                                            )}
                                            <ul className="divide-y divide-gray-100">
                                                {rows.map((item) => (
                                                    <ItemRow key={itemKey(item)} item={item} showRepo={!repo}
                                                        active={activeItem === item} selected={selected.has(itemKey(item))} onToggle={() => toggle(item)} />
                                                ))}
                                            </ul>
                                        </section>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                )}
            </DashboardLayout>

            {merging && (
                <MergeModal
                    items={selectedItems}
                    onClose={() => { setMerging(false); setSelected(new Set()); }}
                    onDone={load}
                />
            )}
        </>
    );
}
