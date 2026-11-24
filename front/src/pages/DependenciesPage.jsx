import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, GitFork, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Select } from '../components/atoms/Select';
import { Checkbox } from '../components/atoms/Checkbox';
import { SearchInput } from '../components/molecules/SearchInput';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';
import { fuzzyFilter } from '../lib/fuzzy';
import { cn } from '../lib/utils';

const MAX_ROWS = 200;

function Stat({ icon: Icon, label, value, tone = 'text-blue-600 bg-blue-100' }) {
    return (
        <Card className="p-4">
            <div className="flex items-center gap-3">
                <div className={cn('p-2 rounded-lg', tone)}><Icon size={20} /></div>
                <div>
                    <Text variant="muted" className="text-xs">{label}</Text>
                    <Text variant="h3">{value}</Text>
                </div>
            </div>
        </Card>
    );
}

function RuntimeTable({ runtimes }) {
    if (runtimes.length === 0) return null;
    return (
        <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Runtimes</h3>
                <Text variant="muted" className="text-xs">Declared in .nvmrc, package.json engines, .python-version, pyproject.toml or go.mod</Text>
            </div>
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                        <th className="px-4 py-2 text-left font-semibold">Repo</th>
                        <th className="px-4 py-2 text-left font-semibold">Runtime</th>
                        <th className="px-4 py-2 text-left font-semibold">Declared</th>
                        <th className="px-4 py-2 text-left font-semibold">End of life</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {runtimes.map(rt => (
                        <tr key={`${rt.repo}:${rt.name}`}>
                            <td className="px-4 py-2 text-gray-900">{rt.repo}</td>
                            <td className="px-4 py-2 text-gray-700">{rt.name}</td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-700" title={rt.source}>{rt.version}</td>
                            <td className="px-4 py-2">
                                {rt.eolDate ? (
                                    <span className={cn(
                                        'inline-flex rounded border px-1.5 py-0.5 text-xs font-medium',
                                        rt.eol ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
                                    )}>
                                        {rt.eol ? 'EOL since' : 'Supported until'} {rt.eolDate}
                                    </span>
                                ) : <span className="text-gray-400">unknown</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );
}

function PackageRow({ pkg, open, onToggle }) {
    return (
        <>
            <tr className="hover:bg-gray-50/50 cursor-pointer" onClick={onToggle}>
                <td className="px-4 py-2">
                    <button type="button" className="flex items-center gap-2 text-left text-gray-900 font-medium" aria-expanded={open}>
                        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        {pkg.name}
                    </button>
                </td>
                <td className="px-4 py-2 text-gray-500">{pkg.ecosystem}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pkg.repo_count}</td>
                <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                        {pkg.majors.map(major => (
                            <span key={major} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">{major}</span>
                        ))}
                        {pkg.divergent && (
                            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">divergent</span>
                        )}
                    </div>
                </td>
            </tr>
            {open && (
                <tr className="bg-gray-50/60">
                    <td colSpan={4} className="px-10 py-2">
                        <ul className="space-y-1">
                            {pkg.usages.map(u => (
                                <li key={`${u.repo}:${u.manifest}:${u.scope}`} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                                    <span className="text-gray-900">{u.repo}</span>
                                    <span className="font-mono text-gray-700">{u.version}</span>
                                    <span className="text-gray-400">{u.scope} · {u.manifest}</span>
                                </li>
                            ))}
                        </ul>
                    </td>
                </tr>
            )}
        </>
    );
}

export function DependenciesPage() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [ecosystem, setEcosystem] = useState('all');
    const [sharedOnly, setSharedOnly] = useState(false);
    const [divergentOnly, setDivergentOnly] = useState(false);
    const [openRows, setOpenRows] = useState(new Set());

    const load = async () => {
        setError(null);
        try {
            const res = await apiFetch('/api/dependencies');
            if (!res.ok) throw new Error('Failed to fetch dependencies');
            setData(await res.json());
        } catch (err) {
            setError(err.message);
        }
    };
    useEffect(() => { load(); }, []);

    const packages = data?.packages || [];
    const runtimes = data?.runtimes || [];
    const ecosystems = useMemo(() => [...new Set(packages.map(p => p.ecosystem))].sort(), [packages]);

    const filtered = useMemo(() => {
        const base = packages.filter(p =>
            (ecosystem === 'all' || p.ecosystem === ecosystem) &&
            (!sharedOnly || p.repo_count > 1) &&
            (!divergentOnly || p.divergent)
        );
        return fuzzyFilter(base, search, p => p.name);
    }, [packages, search, ecosystem, sharedOnly, divergentOnly]);

    if (error) return <ErrorState variant="page" message={error} onRetry={load} />;

    const toggleRow = (key) => setOpenRows(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    return (
        <DashboardLayout
            stats={
                <div className="space-y-4">
                    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                            <ArrowLeft size={16} />
                            Back
                        </Button>
                        <div className="min-w-48 flex-1">
                            <Text variant="h2">Dependencies</Text>
                            <Text variant="muted">Direct dependencies and runtimes declared across your repos</Text>
                        </div>
                    </header>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Stat icon={GitFork} label="Repos synced" value={data ? data.repos_synced : '-'} />
                        <Stat icon={Package} label="Packages" value={data ? packages.length : '-'} tone="text-indigo-600 bg-indigo-100" />
                        <Stat icon={AlertTriangle} label="Divergent majors" value={data ? packages.filter(p => p.divergent).length : '-'} tone="text-amber-600 bg-amber-100" />
                        <Stat icon={AlertTriangle} label="EOL runtimes" value={data ? runtimes.filter(r => r.eol).length : '-'} tone="text-red-600 bg-red-100" />
                    </div>
                </div>
            }
        >
            {!data ? (
                <Text variant="muted">Loading...</Text>
            ) : data.repos_synced === 0 ? (
                <Card className="p-8 text-center">
                    <h3 className="text-sm font-semibold text-gray-900">No dependency data yet</h3>
                    <Text variant="muted" className="mt-1">
                        Select repos on the dashboard and run “Sync signals” to read their manifests.
                    </Text>
                </Card>
            ) : (
                <div className="space-y-6">
                    <RuntimeTable runtimes={runtimes} />

                    <Card className="overflow-hidden">
                        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
                            <SearchInput
                                placeholder="Search packages..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-64"
                            />
                            <Select value={ecosystem} onChange={(e) => setEcosystem(e.target.value)} aria-label="Ecosystem" className="w-40">
                                <option value="all">All ecosystems</option>
                                {ecosystems.map(e => <option key={e} value={e}>{e}</option>)}
                            </Select>
                            <Checkbox label="Used in 2+ repos" checked={sharedOnly} onChange={(e) => setSharedOnly(e.target.checked)} />
                            <Checkbox label="Divergent majors only" checked={divergentOnly} onChange={(e) => setDivergentOnly(e.target.checked)} />
                            <span className="ml-auto text-xs text-gray-500 tabular-nums">
                                {filtered.length > MAX_ROWS ? `Showing ${MAX_ROWS} of ${filtered.length}` : `${filtered.length} packages`}
                            </span>
                        </div>
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                                <tr>
                                    <th className="px-4 py-2 text-left font-semibold">Package</th>
                                    <th className="px-4 py-2 text-left font-semibold">Ecosystem</th>
                                    <th className="px-4 py-2 text-right font-semibold">Repos</th>
                                    <th className="px-4 py-2 text-left font-semibold">Major versions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filtered.slice(0, MAX_ROWS).map(pkg => {
                                    const key = `${pkg.ecosystem}:${pkg.name}`;
                                    return <PackageRow key={key} pkg={pkg} open={openRows.has(key)} onToggle={() => toggleRow(key)} />;
                                })}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No packages match</td></tr>
                                )}
                            </tbody>
                        </table>
                    </Card>
                </div>
            )}
        </DashboardLayout>
    );
}
