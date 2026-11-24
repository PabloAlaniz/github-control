import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ExternalLink } from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { Select } from '../components/atoms/Select';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';

const METRIC_LABELS = {
    stars: 'Stars', loc: 'Lines of code', views: 'Views (14 days)', clones: 'Clones (14 days)', health: 'Health score',
    coverage: 'Coverage', ci: 'CI status', release: 'Latest release', downloads: 'Release downloads',
};
const THEME_LABELS = { auto: 'Follow the reader', light: 'Light', dark: 'Dark' };

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin);
const markdown = (alt, url, link) => (link ? `[![${alt}](${url})](${link})` : `![${alt}](${url})`);

async function readJson(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

function CopyButton({ text, label }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard unavailable (plain HTTP on another host): the text is selectable right there.
        }
    };
    return (
        <Button variant="ghost" size="sm" onClick={copy} className="flex-shrink-0 gap-1.5" aria-label={`Copy ${label}`}>
            {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
        </Button>
    );
}

/** A preview with the Markdown that embeds it. */
function Snippet({ title, preview, code }) {
    return (
        <div className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700">{title}</span>
                {preview}
            </div>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 pl-3">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-2 text-xs text-gray-700">{code}</code>
                <CopyButton text={code} label={title} />
            </div>
        </div>
    );
}

function Disabled({ what, variable }) {
    return (
        <p className="px-4 py-6 text-sm text-gray-600">
            {what} are switched off. Turn them on in <a href="/settings" className="text-blue-600 hover:underline">Settings</a>, under
            Public pages, or set <code className="text-xs">{variable}=true</code> on the server.
        </p>
    );
}

/** Badges, cards and the status page: previews and the Markdown to paste elsewhere. */
export function EmbedsPage() {
    const navigate = useNavigate();
    const [info, setInfo] = useState(null);
    const [repos, setRepos] = useState([]);
    const [error, setError] = useState(null);
    const [repo, setRepo] = useState(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('repo') ?? ''));
    const [theme, setTheme] = useState('auto');
    const [title, setTitle] = useState('');

    const load = useCallback(async () => {
        setError(null);
        try {
            const [embeds, list] = await Promise.all([
                apiFetch('/api/embeds').then(readJson),
                apiFetch('/api/repos').then(readJson),
            ]);
            setInfo(embeds);
            setRepos((Array.isArray(list) ? list : []).filter((r) => r.is_private === false).map((r) => r.full_name).sort());
        } catch (err) {
            setError(err.message);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const selected = repos.includes(repo) ? repo : repos[0] ?? '';
    const base = origin();
    // Everything that goes into a URL is encoded, whatever the form holds.
    const themeQuery = theme === 'auto' ? '' : `theme=${encodeURIComponent(theme)}`;
    const repoPath = selected.split('/').map(encodeURIComponent).join('/');
    const summaryUrl = useMemo(() => {
        const params = [title.trim() && `title=${encodeURIComponent(title.trim())}`, themeQuery].filter(Boolean).join('&');
        return `${base}/api/badges/summary.svg${params ? `?${params}` : ''}`;
    }, [base, title, themeQuery]);

    if (error) return <ErrorState variant="page" message={error} onRetry={load} />;

    const repoUrl = `https://github.com/${repoPath}`;
    const cardUrl = `${base}/api/badges/${repoPath}/card.svg${themeQuery ? `?${themeQuery}` : ''}`;

    return (
        <DashboardLayout
            stats={
                <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                        <ArrowLeft size={16} />
                        Back
                    </Button>
                    <div className="min-w-48 flex-1">
                        <Text variant="h2">Badges and embeds</Text>
                        <Text variant="muted">Images and pages anyone can see without signing in, with the Markdown to paste in a README</Text>
                    </div>
                </header>
            }
        >
            {!info ? (
                <Text variant="muted">Loading...</Text>
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <div className="space-y-6">
                        <Card className="overflow-hidden">
                            <div className="border-b border-gray-100 px-4 py-3">
                                <h3 className="text-sm font-semibold text-gray-900">Summary card</h3>
                                <Text variant="muted" className="text-xs">Totals over your public repos, for a profile or an organization README</Text>
                            </div>
                            {!info.badges ? <Disabled what="Badges and cards" variable="PUBLIC_BADGES" /> : (
                                <>
                                    <div className="flex flex-wrap items-end gap-3 border-b border-gray-100 px-4 py-3">
                                        <div className="min-w-48 flex-1 space-y-1">
                                            <label htmlFor="summary-title" className="text-xs font-medium text-gray-600">Title</label>
                                            <Input id="summary-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Open source at a glance" maxLength={60} />
                                        </div>
                                        <div className="w-44 space-y-1">
                                            <label htmlFor="card-theme" className="text-xs font-medium text-gray-600">Theme</label>
                                            <Select id="card-theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                                                {info.themes.map((t) => <option key={t} value={t}>{THEME_LABELS[t] ?? t}</option>)}
                                            </Select>
                                        </div>
                                    </div>
                                    <div className="px-4 pt-4">
                                        <img src={summaryUrl} alt="Summary card preview" className="max-w-full" />
                                    </div>
                                    <Snippet title="Markdown" code={markdown('Open source at a glance', summaryUrl)} />
                                </>
                            )}
                        </Card>

                        <Card className="overflow-hidden">
                            <div className="border-b border-gray-100 px-4 py-3">
                                <h3 className="text-sm font-semibold text-gray-900">Status page</h3>
                                <Text variant="muted" className="text-xs">The state and 90-day uptime of your active services</Text>
                            </div>
                            {!info.status ? <Disabled what="The status page and its badges" variable="PUBLIC_STATUS" /> : (
                                <>
                                    <p className="px-4 pt-3 text-sm">
                                        <a href="/status" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                            {base}/status <ExternalLink size={12} />
                                        </a>
                                    </p>
                                    <Snippet
                                        title="Status badge"
                                        preview={<img src={`${base}/api/status/badge.svg`} alt="Status badge preview" />}
                                        code={markdown('status', `${base}/api/status/badge.svg`, `${base}/status`)}
                                    />
                                </>
                            )}
                        </Card>
                    </div>

                    <Card className="h-fit overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900">Repo badges</h3>
                                <Text variant="muted" className="text-xs">Public repos only. Add <code>?label=</code> or <code>?style=flat-square</code> to adjust one.</Text>
                            </div>
                            {info.badges && repos.length > 0 && (
                                <div className="w-64">
                                    <Select value={selected} onChange={(e) => setRepo(e.target.value)} aria-label="Repo">
                                        {repos.map((name) => <option key={name} value={name}>{name}</option>)}
                                    </Select>
                                </div>
                            )}
                        </div>
                        {!info.badges ? <Disabled what="Badges and cards" variable="PUBLIC_BADGES" />
                            : repos.length === 0 ? <p className="px-4 py-6 text-sm text-gray-600">No public repos yet.</p> : (
                                <div className="divide-y divide-gray-100">
                                    <div className="px-4 pt-4">
                                        <img src={cardUrl} alt={`Card preview for ${selected}`} className="max-w-full" />
                                        <div className="-mx-4"><Snippet title="Repo card" code={markdown(selected, cardUrl, repoUrl)} /></div>
                                    </div>
                                    {info.metrics.map((metric) => {
                                        const url = `${base}/api/badges/${repoPath}/${encodeURIComponent(metric)}.svg`;
                                        return (
                                            <Snippet
                                                key={metric}
                                                title={METRIC_LABELS[metric] ?? metric}
                                                preview={<img src={url} alt={`${metric} badge preview`} />}
                                                code={markdown(metric, url)}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                    </Card>
                </div>
            )}
        </DashboardLayout>
    );
}
