import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Download, RefreshCw } from 'lucide-react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card } from '../../atoms/Card';
import { Text } from '../../atoms/Text';
import { Button } from '../../atoms/Button';
import { apiFetch } from '../../../lib/api';
import {
    CHART_GRID_STROKE, chartTick, CHART_TOOLTIP_STYLE,
    CHART_TOOLTIP_LABEL_STYLE, CHART_LEGEND_STYLE,
} from '../../../lib/chartTheme';

const TOTAL_COLOR = '#2563eb';   // blue-600
const UNIQUE_COLOR = '#f59e0b';  // amber-500

const formatDay = (day) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' });

function Stat({ icon: Icon, label, value, detail }) {
    return (
        <Card className="p-4">
            <div className="flex items-center gap-2 mb-1 text-gray-500">
                <Icon className="w-4 h-4" />
                <Text variant="muted">{label}</Text>
            </div>
            <Text className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</Text>
            <Text variant="muted">{detail}</Text>
        </Card>
    );
}

function DailyChart({ title, data, totalKey, uniqueKey, totalLabel, uniqueLabel }) {
    return (
        <Card className="p-6">
            <Text variant="large" className="mb-4">{title}</Text>
            <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="date" tick={chartTick} />
                    <YAxis tick={chartTick} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />
                    <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                    <Line type="monotone" dataKey={totalKey} name={totalLabel} stroke={TOTAL_COLOR} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey={uniqueKey} name={uniqueLabel} stroke={UNIQUE_COLOR} strokeWidth={2} dot={false} />
                </LineChart>
            </ResponsiveContainer>
        </Card>
    );
}

function SourceTable({ title, nameHeader, data }) {
    return (
        <Card className="p-6">
            <div className="flex items-baseline justify-between mb-3">
                <Text variant="large">{title}</Text>
                {data.day && <Text variant="muted">14 days to {formatDay(data.day)}</Text>}
            </div>
            {data.sources.length === 0 ? (
                <Text variant="muted">Nothing recorded yet.</Text>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                            <th className="py-2 font-medium">{nameHeader}</th>
                            <th className="py-2 font-medium text-right">Views</th>
                            <th className="py-2 font-medium text-right">Unique</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.sources.map((source) => (
                            <tr key={source.label} className="border-b border-gray-100 last:border-0">
                                <td className="py-2 pr-4 text-gray-900 break-all" title={source.title || source.label}>
                                    {source.label}
                                </td>
                                <td className="py-2 text-right tabular-nums">{source.hits.toLocaleString()}</td>
                                <td className="py-2 text-right tabular-nums text-gray-500">{source.uniques.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );
}

/** Traffic history of one repo: views, clones, referrers and popular paths. */
export function TrafficPanel({ owner, repo, days }) {
    const [traffic, setTraffic] = useState(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await apiFetch(`/api/traffic/repo/${owner}/${repo}?days=${days}`);
            if (res.ok) setTraffic(await res.json());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [owner, repo, days]);

    useEffect(() => {
        setLoading(true);
        load();
    }, [load]);

    async function syncNow() {
        setSyncing(true);
        setError('');
        try {
            const res = await apiFetch(`/api/traffic/repo/${owner}/${repo}/sync`, { method: 'POST' });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || 'Traffic sync failed');
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    }

    const daily = traffic?.daily ?? [];
    const chartData = useMemo(() => daily.map((d) => ({ ...d, date: formatDay(d.day) })), [daily]);
    const totals = useMemo(() => daily.reduce((sum, d) => ({
        views: sum.views + d.views,
        views_unique: sum.views_unique + d.views_unique,
        clones: sum.clones + d.clones,
        clones_unique: sum.clones_unique + d.clones_unique,
    }), { views: 0, views_unique: 0, clones: 0, clones_unique: 0 }), [daily]);

    return (
        <section className="space-y-4" aria-label="Traffic">
            <div className="flex items-center justify-between">
                <div>
                    <Text variant="h3" as="h2">Traffic</Text>
                    <Text variant="muted">
                        GitHub keeps 14 days of traffic. Each sync saves it here, so the history keeps growing.
                    </Text>
                </div>
                <Button variant="outline" onClick={syncNow} disabled={syncing} className="gap-2">
                    <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing ? 'Syncing…' : 'Sync traffic'}
                </Button>
            </div>

            {error && (
                <div role="alert" className="bg-red-50 text-red-600 text-sm p-3 rounded-lg border border-red-200">
                    {error}
                </div>
            )}

            {loading ? (
                <Text variant="muted">Loading traffic...</Text>
            ) : daily.length === 0 ? (
                <Card className="p-6 text-center">
                    <Text variant="large" className="mb-1">No traffic recorded yet</Text>
                    <Text variant="muted">
                        Traffic is collected on every sync, for repositories your token has push access to.
                    </Text>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Stat
                            icon={Eye}
                            label={`Views, last ${days} days`}
                            value={totals.views}
                            detail={`${totals.views_unique.toLocaleString()} unique visitors (daily sum)`}
                        />
                        <Stat
                            icon={Download}
                            label={`Clones, last ${days} days`}
                            value={totals.clones}
                            detail={`${totals.clones_unique.toLocaleString()} unique cloners (daily sum)`}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <DailyChart
                            title="Views per day" data={chartData}
                            totalKey="views" uniqueKey="views_unique" totalLabel="Views" uniqueLabel="Unique visitors"
                        />
                        <DailyChart
                            title="Clones per day" data={chartData}
                            totalKey="clones" uniqueKey="clones_unique" totalLabel="Clones" uniqueLabel="Unique cloners"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <SourceTable title="Referring sites" nameHeader="Site" data={traffic.referrers} />
                        <SourceTable title="Popular content" nameHeader="Path" data={traffic.paths} />
                    </div>
                </>
            )}
        </section>
    );
}
