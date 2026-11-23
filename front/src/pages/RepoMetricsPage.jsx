import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Select } from '../components/atoms/Select';
import { ArrowLeft, GitCommit, Star, GitFork, FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { renderBool } from '../components/organisms/shared/tableHelpers';
import { CiDailyBars, CiWorkflowTable } from '../components/molecules/RepoSignals';
import { formatDuration } from '../lib/signals';
import { TrafficPanel } from '../components/organisms/TrafficPanel';
import {
  CHART_GRID_STROKE, chartTick, CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE, CHART_LEGEND_STYLE
} from '../lib/chartTheme';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

const HealthBadge = ({ value, label }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
    {value ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
    {label}
  </span>
);

export function RepoMetricsPage() {
  const { owner, repo } = useParams();
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fullName = `${owner}/${repo}`;

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/metrics/repo/${owner}/${repo}?days=${timeRange}`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (json) setData(json); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [owner, repo, timeRange]);

  // CI analytics (`ci` signal, synced from the dashboard).
  const [ci, setCi] = useState(null);
  useEffect(() => {
    setCi(null);
    apiFetch(`/api/repos/${owner}/${repo}/signals`)
      .then(res => res.ok ? res.json() : null)
      .then(json => setCi(json?.signals?.ci ?? null))
      .catch(() => setCi(null));
  }, [owner, repo]);

  const snapshots = data?.snapshots || [];
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const first = snapshots.length > 0 ? snapshots[0] : null;

  const chartData = useMemo(() =>
    snapshots.map(s => ({
      date: new Date(s.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      loc: s.code.loc,
      files: s.code.fileCount,
      sizeKb: s.code.sizeKb,
      stars: s.github.stars,
      forks: s.github.forks,
      openIssues: s.github.openIssues,
    })),
    [snapshots],
  );

  const locDelta = latest && first ? latest.code.loc - first.code.loc : 0;
  const filesDelta = latest && first ? latest.code.fileCount - first.code.fileCount : 0;
  const starsDelta = latest && first ? latest.github.stars - first.github.stars : 0;

  return (
    <DashboardLayout
      stats={
        <div className="space-y-4">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => navigate('/metrics')} className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Metrics
              </Button>
              <div>
                <Text size="2xl" weight="bold">{fullName}</Text>
                <Text size="sm" className="text-gray-500">Repository evolution</Text>
              </div>
            </div>

            <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="w-32">
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </Select>
          </header>

          {loading ? (
            <div className="py-12 text-center">
              <Text className="text-gray-500">Loading metrics...</Text>
            </div>
          ) : !latest ? (
            <Card className="p-8 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <Text size="lg" weight="semibold" className="mb-2">No Snapshots</Text>
              <Text className="text-gray-500">
                No metric snapshots found for this repo. Run a health sync to generate data.
              </Text>
            </Card>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <GitCommit className="w-5 h-5 text-green-500" />
                    <Text size="sm" className="text-gray-500">Lines of Code</Text>
                  </div>
                  <Text size="2xl" weight="bold">{latest.code.loc.toLocaleString()}</Text>
                  {locDelta !== 0 && (
                    <Text size="sm" className={locDelta > 0 ? 'text-green-600' : 'text-red-600'}>
                      {locDelta > 0 ? '+' : ''}{locDelta.toLocaleString()} in period
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="w-5 h-5 text-purple-500" />
                    <Text size="sm" className="text-gray-500">Files</Text>
                  </div>
                  <Text size="2xl" weight="bold">{latest.code.fileCount.toLocaleString()}</Text>
                  {filesDelta !== 0 && (
                    <Text size="sm" className={filesDelta > 0 ? 'text-green-600' : 'text-red-600'}>
                      {filesDelta > 0 ? '+' : ''}{filesDelta.toLocaleString()} in period
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Star className="w-5 h-5 text-yellow-500" />
                    <Text size="sm" className="text-gray-500">Stars</Text>
                  </div>
                  <Text size="2xl" weight="bold">{latest.github.stars.toLocaleString()}</Text>
                  {starsDelta !== 0 && (
                    <Text size="sm" className={starsDelta > 0 ? 'text-yellow-600' : 'text-red-600'}>
                      {starsDelta > 0 ? '+' : ''}{starsDelta} in period
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <GitFork className="w-5 h-5 text-blue-500" />
                    <Text size="sm" className="text-gray-500">Forks</Text>
                  </div>
                  <Text size="2xl" weight="bold">{latest.github.forks.toLocaleString()}</Text>
                </Card>
              </div>

              {/* Health Status */}
              <Card className="p-4">
                <Text size="sm" weight="semibold" className="text-gray-500 mb-3">Current Health</Text>
                <div className="flex flex-wrap gap-2">
                  <HealthBadge value={latest.health.hasCi} label="CI" />
                  <HealthBadge value={latest.health.hasTests} label="Tests" />
                  <HealthBadge value={latest.health.hasReadme} label="README" />
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    latest.health.docsQuality === 'excellent' ? 'bg-green-100 text-green-800' :
                    latest.health.docsQuality === 'good' ? 'bg-blue-100 text-blue-800' :
                    latest.health.docsQuality === 'needs_work' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    Docs: {latest.health.docsQuality}
                  </span>
                  {latest.health.readmeLines > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      README: {latest.health.readmeLines} lines
                    </span>
                  )}
                </div>
              </Card>

              {/* CI reliability */}
              {ci?.available && ci.sampled > 0 && (
                <Card className="p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                    <Text size="lg" weight="semibold">CI reliability</Text>
                    <Text size="sm" className="text-gray-500">
                      Last {ci.sampled}{ci.truncated ? '+' : ''} workflow runs over {ci.windowDays} days
                    </Text>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <Text size="sm" className="text-gray-500">Success rate</Text>
                      <Text size="2xl" weight="bold">{ci.successRate === null ? '-' : `${ci.successRate}%`}</Text>
                    </div>
                    <div>
                      <Text size="sm" className="text-gray-500">Avg duration</Text>
                      <Text size="2xl" weight="bold">{formatDuration(ci.avgDurationSec)}</Text>
                    </div>
                    <div>
                      <Text size="sm" className="text-gray-500">Run time</Text>
                      <Text size="2xl" weight="bold">{ci.totalMinutes} min</Text>
                    </div>
                    <div>
                      <Text size="sm" className="text-gray-500">Flaky commits</Text>
                      <Text size="2xl" weight="bold">{ci.flaky}</Text>
                    </div>
                  </div>
                  <Text size="sm" className="text-gray-500 mb-1">Runs per day, last 14 days</Text>
                  <CiDailyBars daily={ci.daily} height={80} />
                  <div className="mt-4">
                    <CiWorkflowTable workflows={ci.workflows} />
                  </div>
                </Card>
              )}

              {/* LOC Evolution Chart */}
              {chartData.length > 1 && (
                <>
                  <Card className="p-6">
                    <Text size="lg" weight="semibold" className="mb-4">Lines of Code Evolution</Text>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="repoLocGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={chartTick} />
                        <YAxis tick={chartTick} tickFormatter={(v) => v.toLocaleString()} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                          formatter={(value) => [value.toLocaleString(), 'LOC']}
                        />
                        <Area type="monotone" dataKey="loc" stroke="#22c55e" fill="url(#repoLocGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>

                  {/* Stars & Forks Chart */}
                  <Card className="p-6">
                    <Text size="lg" weight="semibold" className="mb-4">Stars & Forks</Text>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={chartTick} />
                        <YAxis tick={chartTick} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        />
                        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                        <Line type="monotone" dataKey="stars" name="Stars" stroke="#eab308" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="forks" name="Forks" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="openIssues" name="Open Issues" stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>
                </>
              )}

              {/* Snapshots Table */}
              <Card className="p-6">
                <Text size="lg" weight="semibold" className="mb-4">Snapshot History</Text>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">LOC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Files</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Size KB</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Stars</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">CI</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Tests</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Docs</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {snapshots.slice().reverse().map((s, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-900">{new Date(s.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{s.code.loc.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{s.code.fileCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{s.code.sizeKb.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{s.github.stars}</td>
                          <td className="px-4 py-3 text-sm text-center">
                            {renderBool(s.health.hasCi)}
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            {renderBool(s.health.hasTests)}
                          </td>
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={`text-xs font-medium ${
                              s.health.docsQuality === 'excellent' ? 'text-green-600' :
                              s.health.docsQuality === 'good' ? 'text-blue-600' :
                              s.health.docsQuality === 'needs_work' ? 'text-yellow-600' :
                              'text-gray-500'
                            }`}>
                              {s.health.docsQuality}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}

          <TrafficPanel owner={owner} repo={repo} days={timeRange} />
        </div>
      }
    />
  );
}
