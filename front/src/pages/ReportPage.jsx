import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Select } from '../components/atoms/Select';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';

const PERIODS = [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']];
const signed = (n) => `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}`;

function Section({ title, children, className }) {
    return (
        <Card className={cn('overflow-hidden', className)}>
            <h3 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">{title}</h3>
            <div className="p-4">{children}</div>
        </Card>
    );
}

function Figure({ label, value, tone }) {
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className={cn('text-xl font-semibold tabular-nums text-gray-900', tone)}>{value}</dd>
        </div>
    );
}

const Empty = ({ children }) => <p className="text-sm text-gray-500">{children}</p>;

function Movers({ title, rows, unit }) {
    if (rows.length === 0) return null;
    return (
        <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>
            <ul className="space-y-0.5 text-sm">
                {rows.map((row) => (
                    <li key={row.repo} className="flex justify-between gap-3">
                        <span className="truncate text-gray-800">{row.repo}</span>
                        <span className={cn('flex-shrink-0 tabular-nums', row.delta > 0 ? 'text-green-700' : 'text-red-700')}>{signed(row.delta)} {unit}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** What changed over the last days: the highlights first, then the detail. */
export function ReportPage() {
    const navigate = useNavigate();
    const [days, setDays] = useState(7);
    const [report, setReport] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(async (period) => {
        setError(null);
        try {
            const res = await apiFetch(`/api/report?days=${period}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
            setReport(body);
        } catch (err) {
            setError(err.message);
        }
    }, []);
    useEffect(() => { load(days); }, [load, days]);

    if (error) return <ErrorState variant="page" message={error} onRetry={() => load(days)} />;

    const viewsChange = report && report.traffic.previousViews > 0
        ? Math.round(((report.traffic.views - report.traffic.previousViews) / report.traffic.previousViews) * 100)
        : null;

    return (
        <DashboardLayout
            stats={
                <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                        <ArrowLeft size={16} />
                        Back
                    </Button>
                    <div className="min-w-48 flex-1">
                        <Text variant="h2">Report</Text>
                        <Text variant="muted">What changed across your repos and services</Text>
                    </div>
                    <div className="w-44">
                        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
                            {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </Select>
                    </div>
                </header>
            }
        >
            {!report ? (
                <Text variant="muted">Loading...</Text>
            ) : (
                <div className="space-y-6">
                    <Card className="p-5">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">In short</h3>
                        <ul className="space-y-1.5 text-sm text-gray-900" aria-label="Highlights">
                            {report.highlights.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                    </Card>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <Section title="Growth">
                            <dl className="mb-4 grid grid-cols-3 gap-4">
                                <Figure label="Stars" value={signed(report.growth.stars)} />
                                <Figure label="Lines of code" value={signed(report.growth.loc)} />
                                <Figure label="Views" value={report.traffic.views.toLocaleString('en-US')}
                                    tone={viewsChange === null || Math.abs(viewsChange) < 10 ? undefined : viewsChange > 0 ? 'text-green-700' : 'text-red-700'} />
                            </dl>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Movers title="Stars" rows={report.growth.topStars} unit="" />
                                <Movers title="Code" rows={report.growth.topLoc} unit="lines" />
                            </div>
                            {viewsChange !== null && <p className="mt-3 text-xs text-gray-500">Views are {viewsChange >= 0 ? 'up' : 'down'} {Math.abs(viewsChange)}% on the period before ({report.traffic.previousViews.toLocaleString('en-US')}).</p>}
                        </Section>

                        <Section title="Pull requests and issues">
                            <dl className="grid grid-cols-3 gap-4">
                                <Figure label="Open pull requests" value={report.inbox.openPrs} />
                                <Figure label="Open issues" value={report.inbox.openIssues} />
                                <Figure label="Ready to merge" value={report.inbox.readyToMerge} tone={report.inbox.readyToMerge > 0 ? 'text-green-700' : undefined} />
                            </dl>
                            <p className="mt-3 text-xs text-gray-500">
                                Opened in the period and still open: {report.inbox.prsOpened} pull request{report.inbox.prsOpened === 1 ? '' : 's'}, {report.inbox.issuesOpened} issue{report.inbox.issuesOpened === 1 ? '' : 's'}.
                            </p>
                        </Section>

                        <Section title={`Alerts (${report.alerts.opened} opened, ${report.alerts.resolved} resolved)`}>
                            {report.alerts.open.length === 0 ? <Empty>Nothing open.</Empty> : (
                                <ul className="space-y-1 text-sm text-gray-800">
                                    {report.alerts.open.slice(0, 10).map((alert) => <li key={`${alert.kind}:${alert.title}`}>{alert.title}</li>)}
                                    {report.alerts.open.length > 10 && <li className="text-gray-500">…and {report.alerts.open.length - 10} more</li>}
                                </ul>
                            )}
                        </Section>

                        <Section title="Releases">
                            {report.releases.length === 0 ? <Empty>None published in the period.</Empty> : (
                                <ul className="space-y-1 text-sm">
                                    {report.releases.map((release) => (
                                        <li key={`${release.repo}:${release.tag}`} className="flex justify-between gap-3">
                                            <span className="truncate text-gray-800">
                                                {release.repo}{' '}
                                                {release.url
                                                    ? <a href={release.url} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline">{release.tag}</a>
                                                    : <span className="font-mono">{release.tag}</span>}
                                            </span>
                                            <span className="flex-shrink-0 text-xs text-gray-500">{new Date(release.publishedAt).toLocaleDateString()}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>

                        <Section title="CI">
                            {report.ci.failing.length === 0 ? <Empty>No repo has a failing build.</Empty> : (
                                <ul className="space-y-1 text-sm text-red-700">
                                    {report.ci.failing.map((repo) => <li key={repo}>{repo}</li>)}
                                </ul>
                            )}
                        </Section>

                        <Section title="Services">
                            {report.services.length === 0 ? <Empty>No services are monitored.</Empty> : (
                                <ul className="space-y-1 text-sm">
                                    {report.services.map((service) => (
                                        <li key={service.name} className="flex justify-between gap-3">
                                            <span className="text-gray-800">{service.name}</span>
                                            <span className="tabular-nums text-gray-600">
                                                {service.uptimePct === null ? 'no checks' : `${service.uptimePct}% up`}
                                                {service.incidents > 0 && <span className="ml-2 text-red-700">{service.incidents} incident{service.incidents === 1 ? '' : 's'}</span>}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Section>
                    </div>

                    {report.repos.added.length > 0 && (
                        <p className="text-sm text-gray-600">New repos: {report.repos.added.map((repo) => repo.repo).join(', ')}.</p>
                    )}
                </div>
            )}
        </DashboardLayout>
    );
}
