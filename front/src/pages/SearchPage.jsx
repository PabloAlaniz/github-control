import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileCode, Loader2, Search } from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { Select } from '../components/atoms/Select';
import { apiFetch } from '../lib/api';
import { writeViewQueryToUrl } from '../lib/viewState';

const readParams = () => {
    const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    return { q: params.get('q') ?? '', repo: params.get('repo') ?? '', language: params.get('language') ?? '' };
};

const toQuery = ({ q, repo, language }) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (repo) params.set('repo', repo);
    if (language.trim()) params.set('language', language.trim());
    return params.toString();
};

/** `text` with the matched ranges marked. Ranges come from GitHub as [start, end). */
function Highlighted({ text, highlights }) {
    const ranges = [...highlights].sort((a, b) => a[0] - b[0]);
    const parts = [];
    let at = 0;
    ranges.forEach(([start, end], index) => {
        if (start < at || end <= start) return;
        if (start > at) parts.push(text.slice(at, start));
        parts.push(<mark key={index} className="rounded bg-yellow-200 px-0.5 text-gray-900">{text.slice(start, end)}</mark>);
        at = end;
    });
    parts.push(text.slice(at));
    return <>{parts}</>;
}

function FileResult({ file }) {
    return (
        <li className="px-4 py-3">
            <a href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:underline">
                <FileCode size={14} className="flex-shrink-0 text-gray-400" />
                {file.path}
            </a>
            {file.matches.map((match, index) => (
                <pre key={index} className="mt-2 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-2 text-xs leading-relaxed text-gray-800">
                    <Highlighted text={match.text} highlights={match.highlights} />
                </pre>
            ))}
        </li>
    );
}

/** Search the code of every tracked repo on GitHub. */
export function SearchPage() {
    const navigate = useNavigate();
    const [form, setForm] = useState(readParams);
    const [repos, setRepos] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [searching, setSearching] = useState(false);
    const latest = useRef(0);

    const search = useCallback(async (values) => {
        const query = toQuery(values);
        writeViewQueryToUrl(query);
        if (!values.q.trim()) {
            setResult(null);
            setError('');
            return;
        }
        const id = ++latest.current;
        setSearching(true);
        setError('');
        try {
            const res = await apiFetch(`/api/search/code?${query}`);
            const body = await res.json().catch(() => ({}));
            if (id !== latest.current) return;   // a newer search is on its way
            if (!res.ok) throw new Error(body.error || `Search failed (${res.status})`);
            setResult(body);
        } catch (err) {
            if (id !== latest.current) return;
            setResult(null);
            setError(err.message);
        } finally {
            if (id === latest.current) setSearching(false);
        }
    }, []);

    // Run the search the URL asks for, and load the repos for the filter.
    useEffect(() => {
        search(readParams());
        apiFetch('/api/repos')
            .then((res) => (res.ok ? res.json() : []))
            .then((list) => setRepos((Array.isArray(list) ? list : []).map((repo) => repo.full_name).sort()))
            .catch(() => undefined);
    }, [search]);

    const submit = (event) => {
        event.preventDefault();
        search(form);
    };
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

    return (
        <DashboardLayout
            stats={
                <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                        <ArrowLeft size={16} />
                        Back
                    </Button>
                    <div className="min-w-48 flex-1">
                        <Text variant="h2">Search code</Text>
                        <Text variant="muted">Across the default branch of every repo on the dashboard, searched on GitHub</Text>
                    </div>
                </header>
            }
        >
            <div className="space-y-6">
                <Card className="p-4">
                    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" role="search">
                        <div className="min-w-64 flex-1 space-y-1">
                            <label htmlFor="search-q" className="text-xs font-medium text-gray-600">Look for</label>
                            <Input id="search-q" value={form.q} onChange={(e) => set({ q: e.target.value })} autoFocus maxLength={200}
                                placeholder='createStorage, "exact phrase", TODO path:src, filename:Dockerfile' />
                        </div>
                        <div className="w-56 space-y-1">
                            <label htmlFor="search-repo" className="text-xs font-medium text-gray-600">Repo</label>
                            <Select id="search-repo" value={repos.includes(form.repo) ? form.repo : ''} onChange={(e) => set({ repo: e.target.value })}>
                                <option value="">All repos</option>
                                {repos.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
                            </Select>
                        </div>
                        <div className="w-40 space-y-1">
                            <label htmlFor="search-language" className="text-xs font-medium text-gray-600">Language</label>
                            <Input id="search-language" value={form.language} onChange={(e) => set({ language: e.target.value })} placeholder="any" maxLength={40} />
                        </div>
                        <Button type="submit" disabled={searching || !form.q.trim()} className="gap-2">
                            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                            Search
                        </Button>
                    </form>
                </Card>

                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

                {result && (
                    <>
                        <p className="text-sm text-gray-600" role="status">
                            {result.shown === 0
                                ? `Nothing found for “${result.query}”.`
                                : `${result.shown} file${result.shown === 1 ? '' : 's'} in ${result.repos.length} repo${result.repos.length === 1 ? '' : 's'}`}
                            {result.total > result.shown && result.shown > 0 && ` (GitHub found ${result.total}; these are the first, from the repos on the dashboard)`}
                            {result.incomplete && ' · GitHub ran out of time, so results may be partial'}
                        </p>
                        {result.ownersSkipped.length > 0 && (
                            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                Too many owners to search at once. Not searched: {result.ownersSkipped.join(', ')}. Pick a repo to search it.
                            </p>
                        )}
                        {result.repos.map((group) => (
                            <Card key={group.repo} className="overflow-hidden">
                                <div className="flex items-baseline gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
                                    <h3 className="text-sm font-semibold text-gray-900">{group.repo}</h3>
                                    <span className="text-xs text-gray-500">{group.files.length}</span>
                                </div>
                                <ul className="divide-y divide-gray-100">
                                    {group.files.map((file) => <FileResult key={file.path} file={file} />)}
                                </ul>
                            </Card>
                        ))}
                    </>
                )}

                {!result && !error && !searching && (
                    <p className="text-sm text-gray-500">
                        Type what to look for and press Enter. GitHub qualifiers work too: <code>path:</code>, <code>filename:</code>, <code>extension:</code>.
                        GitHub allows about 10 code searches a minute.
                    </p>
                )}
            </div>
        </DashboardLayout>
    );
}
