import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Download } from 'lucide-react';
import { Card } from '../../atoms/Card';
import { Text } from '../../atoms/Text';
import { apiFetch } from '../../../lib/api';

const TOP_REPOS = 10;

/** Traffic across all repos for the selected period: totals and the most visited repos. */
export function TrafficOverview({ days }) {
    const [summary, setSummary] = useState(null);

    useEffect(() => {
        let active = true;
        apiFetch(`/api/traffic/summary?days=${days}`)
            .then((res) => (res?.ok ? res.json() : null))
            .then((json) => { if (active) setSummary(json); })
            .catch(() => { if (active) setSummary(null); });
        return () => { active = false; };
    }, [days]);

    // Nothing recorded (or the request failed): the page is fine without this block.
    if (!summary || summary.repos.length === 0) return null;

    const { totals, repos } = summary;
    const busiest = Math.max(...repos.map((r) => r.views), 1);

    return (
        <Card className="p-6" aria-label="Traffic overview">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <Text variant="large">Traffic, last {days} days</Text>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="inline-flex items-center gap-1">
                        <Eye className="w-4 h-4" /> {totals.views.toLocaleString()} views
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <Download className="w-4 h-4" /> {totals.clones.toLocaleString()} clones
                    </span>
                </div>
            </div>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                        <th className="py-2 font-medium">Repository</th>
                        <th className="py-2 font-medium w-1/3">Share of views</th>
                        <th className="py-2 font-medium text-right">Views</th>
                        <th className="py-2 font-medium text-right">Unique</th>
                        <th className="py-2 font-medium text-right">Clones</th>
                    </tr>
                </thead>
                <tbody>
                    {repos.slice(0, TOP_REPOS).map((repo) => (
                        <tr key={repo.full_name} className="border-b border-gray-100 last:border-0">
                            <td className="py-2 pr-4">
                                <Link to={`/metrics/${repo.full_name}`} className="text-blue-600 hover:underline">
                                    {repo.full_name}
                                </Link>
                            </td>
                            <td className="py-2 pr-4">
                                <div className="h-2 rounded bg-gray-100" aria-hidden="true">
                                    <div
                                        className="h-2 rounded bg-blue-500"
                                        style={{ width: `${Math.round((repo.views / busiest) * 100)}%` }}
                                    />
                                </div>
                            </td>
                            <td className="py-2 text-right tabular-nums">{repo.views.toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums text-gray-500">{repo.views_unique.toLocaleString()}</td>
                            <td className="py-2 text-right tabular-nums">{repo.clones.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {repos.length > TOP_REPOS && (
                <Text variant="muted" className="mt-3">Showing the {TOP_REPOS} most viewed of {repos.length} repositories.</Text>
            )}
        </Card>
    );
}
