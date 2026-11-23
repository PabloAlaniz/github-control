import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Select } from '../components/atoms/Select';
import { ArrowLeft, TrendingUp, BarChart3, GitCommit, Star, GitFork, AlertCircle, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/atoms/Badge';
import { apiFetch } from '../lib/api';
import { TrafficOverview } from '../components/organisms/TrafficOverview';
import {
  CHART_GRID_STROKE, chartTick, CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_LABEL_STYLE, CHART_LEGEND_STYLE
} from '../lib/chartTheme';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';

export function MetricsPage() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState('30');
  const [aggregateData, setAggregateData] = useState([]);
  const [latestSnapshot, setLatestSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [compareData, setCompareData] = useState([]);

  useEffect(() => {
    const fetchMetrics = async () => {
      setLoading(true);
      try {
        const [aggregateRes, latestRes] = await Promise.all([
          apiFetch(`/api/metrics/aggregate?days=${timeRange}`),
          apiFetch('/api/metrics/latest')
        ]);

        if (aggregateRes.ok) {
          const data = await aggregateRes.json();
          setAggregateData(data.snapshots || []);
        }

        if (latestRes.ok) {
          const data = await latestRes.json();
          setLatestSnapshot(data.latestSnapshot);
        }
      } catch (err) {
        console.error('Failed to fetch metrics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [timeRange]);

  const latest = aggregateData.length > 0 ? aggregateData[aggregateData.length - 1] : null;
  const previous = aggregateData.length > 1 ? aggregateData[aggregateData.length - 2] : null;

  const chartData = useMemo(() => aggregateData.map(s => ({
    date: new Date(s.date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
    loc: s.code.totalLoc,
    files: s.code.totalFiles,
    repos: s.totalRepos,
    stars: s.github.totalStars,
    forks: s.github.totalForks,
    withCi: s.health.reposWithCi,
    withTests: s.health.reposWithTests,
    withReadme: s.health.reposWithReadme,
  })), [aggregateData]);

  useEffect(() => {
    if (aggregateData.length < 2) return;
    const from = aggregateData[0].date;
    const to = aggregateData[aggregateData.length - 1].date;
    if (from === to) return;
    apiFetch(`/api/metrics/compare?from=${from}&to=${to}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setCompareData(data.changes || []); })
      .catch(() => {});
  }, [aggregateData]);

  const repoActivityData = useMemo(() =>
    compareData
      .filter(c => c.deltas.loc !== 0 && !c.isNew && !c.isRemoved)
      .slice(0, 15)
      .map(c => ({
        name: c.repo.split('/').pop(),
        fullName: c.repo,
        loc: c.deltas.loc,
        files: c.deltas.fileCount,
        stars: c.deltas.stars,
        forks: c.deltas.forks,
        currentLoc: c.current.loc,
      })),
    [compareData]
  );

  const newReposData = useMemo(() =>
    compareData.filter(c => c.isNew),
    [compareData]
  );

  const calculateDelta = (current, prev) => {
    if (!prev || prev === 0) return 0;
    return ((current - prev) / prev * 100).toFixed(1);
  };

  return (
    <DashboardLayout
      stats={
        <div className="space-y-4">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/')}
                className="gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              <div>
                <Text size="2xl" weight="bold">Repository Metrics</Text>
                <Text size="sm" className="text-gray-500">
                  Historical tracking and trends
                </Text>
              </div>
            </div>

            <Select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-32"
            >
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
              <Text size="lg" weight="semibold" className="mb-2">No Data Available</Text>
              <Text className="text-gray-500 mb-4">
                Run the daily snapshot script to start collecting metrics
              </Text>
              <code className="text-sm bg-gray-100 text-gray-800 px-3 py-1.5 rounded font-mono">
                node scripts/daily-snapshot.js
              </code>
            </Card>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    <Text size="sm" className="text-gray-500">Total Repositories</Text>
                  </div>
                  <Text size="2xl" weight="bold">{latest.totalRepos}</Text>
                  {previous && (
                    <Text size="sm" className="text-gray-500 mt-1">
                      {calculateDelta(latest.totalRepos, previous.totalRepos) >= 0 ? '+' : ''}
                      {calculateDelta(latest.totalRepos, previous.totalRepos)}%
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <GitCommit className="w-5 h-5 text-green-500" />
                    <Text size="sm" className="text-gray-500">Lines of Code</Text>
                  </div>
                  <Text size="2xl" weight="bold">
                    {latest.code.totalLoc.toLocaleString()}
                  </Text>
                  {previous && (
                    <Text size="sm" className="text-gray-500 mt-1">
                      {calculateDelta(latest.code.totalLoc, previous.code.totalLoc) >= 0 ? '+' : ''}
                      {calculateDelta(latest.code.totalLoc, previous.code.totalLoc)}%
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Star className="w-5 h-5 text-yellow-500" />
                    <Text size="sm" className="text-gray-500">Total Stars</Text>
                  </div>
                  <Text size="2xl" weight="bold">
                    {latest.github.totalStars.toLocaleString()}
                  </Text>
                  {previous && (
                    <Text size="sm" className="text-gray-500 mt-1">
                      {calculateDelta(latest.github.totalStars, previous.github.totalStars) >= 0 ? '+' : ''}
                      {calculateDelta(latest.github.totalStars, previous.github.totalStars)}%
                    </Text>
                  )}
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="w-5 h-5 text-purple-500" />
                    <Text size="sm" className="text-gray-500">Code Files</Text>
                  </div>
                  <Text size="2xl" weight="bold">
                    {latest.code.totalFiles.toLocaleString()}
                  </Text>
                  {previous && (
                    <Text size="sm" className="text-gray-500 mt-1">
                      {calculateDelta(latest.code.totalFiles, previous.code.totalFiles) >= 0 ? '+' : ''}
                      {calculateDelta(latest.code.totalFiles, previous.code.totalFiles)}%
                    </Text>
                  )}
                </Card>
              </div>

              {/* Health Overview */}
              <Card className="p-6">
                <Text size="lg" weight="semibold" className="mb-4">Repository Health</Text>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <Text size="sm" className="text-gray-500 mb-1">With CI</Text>
                    <Text size="xl" weight="bold" className="text-green-600">
                      {latest.health.reposWithCi}
                      <Text size="sm" weight="normal" className="text-gray-500 ml-2 inline">
                        ({((latest.health.reposWithCi / latest.totalRepos) * 100).toFixed(0)}%)
                      </Text>
                    </Text>
                  </div>
                  <div>
                    <Text size="sm" className="text-gray-500 mb-1">With Tests</Text>
                    <Text size="xl" weight="bold" className="text-blue-600">
                      {latest.health.reposWithTests}
                      <Text size="sm" weight="normal" className="text-gray-500 ml-2 inline">
                        ({((latest.health.reposWithTests / latest.totalRepos) * 100).toFixed(0)}%)
                      </Text>
                    </Text>
                  </div>
                  <div>
                    <Text size="sm" className="text-gray-500 mb-1">With README</Text>
                    <Text size="xl" weight="bold" className="text-yellow-600">
                      {latest.health.reposWithReadme}
                      <Text size="sm" weight="normal" className="text-gray-500 ml-2 inline">
                        ({((latest.health.reposWithReadme / latest.totalRepos) * 100).toFixed(0)}%)
                      </Text>
                    </Text>
                  </div>
                  <div>
                    <Text size="sm" className="text-gray-500 mb-1">Excellent Docs</Text>
                    <Text size="xl" weight="bold" className="text-purple-600">
                      {latest.health.docsQuality.excellent}
                      <Text size="sm" weight="normal" className="text-gray-500 ml-2 inline">
                        ({((latest.health.docsQuality.excellent / latest.totalRepos) * 100).toFixed(0)}%)
                      </Text>
                    </Text>
                  </div>
                </div>
              </Card>

              {/* LOC Evolution Chart */}
              {chartData.length > 1 && (
                <>
                  <Card className="p-6">
                    <Text size="lg" weight="semibold" className="mb-4">Lines of Code Evolution</Text>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="locGradient" x1="0" y1="0" x2="0" y2="1">
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
                        <Area type="monotone" dataKey="loc" stroke="#22c55e" fill="url(#locGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>

                  {/* Repos & Health Chart */}
                  <Card className="p-6">
                    <Text size="lg" weight="semibold" className="mb-4">Repositories & Health</Text>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={chartTick} />
                        <YAxis tick={chartTick} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        />
                        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                        <Line type="monotone" dataKey="repos" name="Total Repos" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="withCi" name="With CI" stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="withTests" name="With Tests" stroke="#a855f7" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="withReadme" name="With README" stroke="#eab308" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Card>

                  {/* Stars & Forks Chart */}
                  <Card className="p-6">
                    <Text size="lg" weight="semibold" className="mb-4">Stars & Forks</Text>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData}>
                        <defs>
                          <linearGradient id="starsGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="forksGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                        <XAxis dataKey="date" tick={chartTick} />
                        <YAxis tick={chartTick} />
                        <Tooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        />
                        <Legend wrapperStyle={CHART_LEGEND_STYLE} />
                        <Area type="monotone" dataKey="stars" name="Stars" stroke="#eab308" fill="url(#starsGradient)" strokeWidth={2} />
                        <Area type="monotone" dataKey="forks" name="Forks" stroke="#3b82f6" fill="url(#forksGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>
                </>
              )}

              {/* Repo Activity */}
              {repoActivityData.length > 0 && (
                <Card className="p-6">
                  <div className="mb-4">
                    <Text size="lg" weight="semibold">Repo Activity</Text>
                    {aggregateData.length >= 2 && (
                      <Text size="sm" className="text-gray-500">
                        Changes from {new Date(aggregateData[0].date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} to {new Date(aggregateData[aggregateData.length - 1].date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                      </Text>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max(250, repoActivityData.length * 36)}>
                    <BarChart data={repoActivityData} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
                      <XAxis type="number" tick={chartTick} tickFormatter={(v) => v.toLocaleString()} />
                      <YAxis type="category" dataKey="name" tick={chartTick} width={140} />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        labelStyle={CHART_TOOLTIP_LABEL_STYLE}
                        formatter={(value, name) => {
                          if (name === 'loc') return [`${value > 0 ? '+' : ''}${value.toLocaleString()} LOC`, 'Lines of Code'];
                          return [value, name];
                        }}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="loc" radius={[0, 4, 4, 0]}>
                        {repoActivityData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.loc > 0 ? '#22c55e' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Detail table */}
                  <div className="overflow-x-auto mt-6 border-t border-gray-200 pt-4">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Repo</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">LOC</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Files</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Stars</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Forks</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Current LOC</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {repoActivityData.map((repo, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-3 text-sm">
                              <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); navigate(`/metrics/${repo.fullName}`); }}
                                className="text-blue-600 hover:text-blue-700 hover:underline"
                              >
                                {repo.fullName}
                              </a>
                            </td>
                            <td className={`px-4 py-3 text-sm text-right font-medium ${repo.loc > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {repo.loc > 0 ? '+' : ''}{repo.loc.toLocaleString()}
                            </td>
                            <td className={`px-4 py-3 text-sm text-right ${repo.files > 0 ? 'text-green-600' : repo.files < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {repo.files > 0 ? '+' : ''}{repo.files.toLocaleString()}
                            </td>
                            <td className={`px-4 py-3 text-sm text-right ${repo.stars > 0 ? 'text-yellow-600' : repo.stars < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {repo.stars > 0 ? '+' : ''}{repo.stars}
                            </td>
                            <td className={`px-4 py-3 text-sm text-right ${repo.forks > 0 ? 'text-blue-600' : repo.forks < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              {repo.forks > 0 ? '+' : ''}{repo.forks}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-500">{repo.currentLoc.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* New repos in this period */}
                  {newReposData.length > 0 && (
                    <div className="mt-6 border-t border-gray-200 pt-4">
                      <Text size="sm" weight="semibold" className="text-gray-500 mb-3">
                        New repos added in this period ({newReposData.length})
                      </Text>
                      <div className="flex flex-wrap gap-2">
                        {newReposData.map((repo, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-sm cursor-pointer hover:bg-blue-100 transition-colors"
                            onClick={() => navigate(`/metrics/${repo.repo}`)}
                          >
                            <Badge variant="primary" className="text-[10px] px-1.5 py-0">New</Badge>
                            <span className="text-gray-900 font-medium">{repo.repo.split('/').pop()}</span>
                            <span className="text-gray-500">{repo.current.loc.toLocaleString()} LOC</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {/* Trends Detail Table */}
              <Card className="p-6">
                <Text size="lg" weight="semibold" className="mb-4">Trends Detail</Text>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Repos</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">LOC</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Files</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Stars</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Forks</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {aggregateData.slice(-10).reverse().map((snapshot, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-900">{new Date(snapshot.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{snapshot.totalRepos}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{snapshot.code.totalLoc.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{snapshot.code.totalFiles.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{snapshot.github.totalStars.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900">{snapshot.github.totalForks.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <TrafficOverview days={timeRange} />

              {/* Latest Snapshot Info */}
              {latestSnapshot && (
                <Card className="p-4 bg-gray-50">
                  <Text size="sm" className="text-gray-500">
                    Latest snapshot: {new Date(latestSnapshot).toLocaleDateString()} at{' '}
                    {new Date(latestSnapshot).toLocaleTimeString()}
                  </Text>
                </Card>
              )}
            </>
          )}
        </div>
      }
    />
  );
}
