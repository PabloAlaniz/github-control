import React, { useState } from 'react';
import { CheckCircle, XCircle, MinusCircle, HelpCircle, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { signalChips, signalsCheckedAt, daysSince, formatDuration } from '../../../lib/signals';

const TONES = {
    ok: 'bg-green-50 text-green-700 border-green-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    bad: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-gray-50 text-gray-600 border-gray-200',
};

/** Compact signal chips for a table row. */
export function SignalChips({ repo }) {
    const chips = signalChips(repo);
    if (chips.length === 0) return <span className="text-gray-300">-</span>;
    return (
        <div className="flex flex-wrap items-center gap-1 w-[210px]">
            {chips.map(chip => (
                <span
                    key={chip.key}
                    title={chip.title}
                    className={cn(
                        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap tabular-nums',
                        TONES[chip.tone] || TONES.neutral
                    )}
                >
                    {chip.label}
                </span>
            ))}
        </div>
    );
}

function SignalCard({ title, summary, children }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 min-w-[240px] max-w-sm flex-1">
            <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">{title}</span>
                {summary && <span className="text-xs text-gray-500 tabular-nums">{summary}</span>}
            </div>
            {children}
        </div>
    );
}

function CheckIcon({ check }) {
    if (!check.applicable) return <MinusCircle size={14} className="text-gray-300 flex-shrink-0" aria-label="Not applicable" />;
    if (check.passed === true) return <CheckCircle size={14} className="text-green-500 flex-shrink-0" aria-label="Pass" />;
    if (check.passed === false) return <XCircle size={14} className="text-red-400 flex-shrink-0" aria-label="Fail" />;
    return <HelpCircle size={14} className="text-gray-300 flex-shrink-0" aria-label="Unknown" />;
}

function StandardsCard({ data }) {
    return (
        <SignalCard title="Standards" summary={`${data.passed}/${data.total}`}>
            <ul className="space-y-1">
                {(data.checks || []).map(check => (
                    <li key={check.key} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5"><CheckIcon check={check} /></span>
                        <span className={cn(check.applicable ? 'text-gray-700' : 'text-gray-400')}>
                            {check.label}
                            {!check.applicable && <span className="italic"> — n/a (private repo)</span>}
                            {check.applicable && check.passed === false && (
                                <span className="block text-gray-400">{check.hint}</span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
        </SignalCard>
    );
}

/** The policy's own checks (see the Policy page). */
function PolicyCard({ data }) {
    return (
        <SignalCard title="Policy checks" summary={`${data.passed}/${data.total}`}>
            <ul className="space-y-1">
                {data.checks.map(check => (
                    <li key={check.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5"><CheckIcon check={{ ...check, applicable: check.passed !== null }} /></span>
                        <span className={cn(check.passed === null ? 'text-gray-400' : 'text-gray-700')}>
                            {check.label}
                            {check.passed === null && <span className="italic"> — n/a</span>}
                        </span>
                    </li>
                ))}
            </ul>
        </SignalCard>
    );
}

const VULN_TONES = { critical: 'text-red-700', high: 'text-orange-700', moderate: 'text-amber-700', low: 'text-gray-600', unknown: 'text-gray-500' };

/** Known vulnerabilities of the versions the lockfiles pin, when the policy asks for the lookup. */
function VulnerabilitiesCard({ data }) {
    const items = data.worst ?? [];
    const counts = Object.entries(data.bySeverity ?? {}).filter(([, count]) => count > 0);
    return (
        <SignalCard title="Known vulnerabilities" summary={data.checked > 0 ? `${data.checked.toLocaleString('en-US')} pinned` : undefined}>
            {data.checked === 0 ? (
                <p className="text-xs text-gray-400 italic">No lockfile to check</p>
            ) : data.total === 0 ? (
                <p className="text-xs text-green-700">None in the pinned versions</p>
            ) : (
                <div className="text-xs text-gray-700 space-y-1.5">
                    <p>{counts.map(([severity, count]) => <span key={severity} className={cn('mr-2 font-medium', VULN_TONES[severity])}>{count} {severity}</span>)}</p>
                    <ul className="space-y-1">
                        {items.map(item => (
                            <li key={`${item.name}:${item.version}:${item.id}`}>
                                <a href={item.url} target="_blank" rel="noopener noreferrer" className={cn('font-mono hover:underline', VULN_TONES[item.severity])} title={item.summary}>
                                    {item.name} {item.version}
                                </a>
                                <span className="text-gray-500">{item.fixed ? ` → ${item.fixed}` : ' (no fix known)'}</span>
                            </li>
                        ))}
                        {data.total > items.length && <li className="text-gray-400">…and {data.total - items.length} more</li>}
                    </ul>
                </div>
            )}
        </SignalCard>
    );
}

const scorecardTone = (score) => (score >= 7 ? 'text-green-700' : score >= 4 ? 'text-amber-700' : 'text-red-700');

/** OpenSSF Scorecard of a public repo, when the policy asks for it. */
function ScorecardCard({ data, repoFullName }) {
    if (!data.available) {
        return (
            <SignalCard title="OpenSSF Scorecard">
                <p className="text-xs text-gray-400 italic">
                    {data.reason === 'private' ? 'Only for public repos' : 'Not scanned by the Scorecard project yet'}
                </p>
            </SignalCard>
        );
    }
    return (
        <SignalCard title="OpenSSF Scorecard" summary={data.date ? new Date(data.date).toLocaleDateString() : undefined}>
            <div className="text-xs text-gray-700 space-y-1.5">
                <div>
                    <span className={cn('text-base font-semibold tabular-nums', scorecardTone(data.score ?? 0))}>{data.score ?? '–'}</span>
                    <span className="text-gray-500"> / 10</span>
                </div>
                {data.weakest?.length > 0 && (
                    <ul className="space-y-0.5">
                        {data.weakest.map(check => (
                            <li key={check.name} className="flex justify-between gap-2" title={check.reason || undefined}>
                                <span className="truncate">{check.name}</span>
                                <span className={cn('tabular-nums font-medium', scorecardTone(check.score))}>{check.score}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <a
                    href={`https://scorecard.dev/viewer/?uri=github.com/${repoFullName}`}
                    target="_blank" rel="noopener noreferrer" className="inline-block text-blue-600 hover:underline"
                >
                    Full report
                </a>
            </div>
        </SignalCard>
    );
}

const SEVERITY_TONE = {
    critical: 'text-red-700 bg-red-50 border-red-200',
    high: 'text-orange-700 bg-orange-50 border-orange-200',
    medium: 'text-amber-700 bg-amber-50 border-amber-200',
    low: 'text-gray-600 bg-gray-50 border-gray-200',
};
const SOURCE_LABELS = { dependabot: 'Dependencies', codeScanning: 'Code scanning', secretScanning: 'Secrets' };

function SecurityCard({ data }) {
    if (!data.available) {
        return (
            <SignalCard title="Security">
                <p className="text-xs text-gray-400 italic">
                    Not available: alerts are disabled for this repo or the token cannot read them.
                </p>
            </SignalCard>
        );
    }
    // The repo list only brings the most severe ones (`top`); the full detail lives in `items`.
    const top = data.top || data.items || [];
    const shown = Math.min(5, top.length);
    return (
        <SignalCard title="Security" summary={data.total === 0 ? 'no open alerts' : `${data.total} open`}>
            <ul className="space-y-1 text-xs text-gray-700">
                {Object.entries(data.sources || {}).map(([key, src]) => (
                    <li key={key} className="flex justify-between gap-4">
                        <span>{SOURCE_LABELS[key] || key}</span>
                        <span className="tabular-nums text-gray-500">
                            {src.available ? `${src.open}${src.truncated ? '+' : ''}` : 'n/a'}
                        </span>
                    </li>
                ))}
            </ul>
            {top.length > 0 && (
                <ul className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                    {top.slice(0, 5).map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                            <span className={cn('rounded border px-1 text-[10px] font-medium flex-shrink-0', SEVERITY_TONE[item.severity])}>
                                {item.severity}
                            </span>
                            {item.url
                                ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:underline break-words">{item.title}</a>
                                : <span className="text-gray-700 break-words">{item.title}</span>}
                        </li>
                    ))}
                    {data.total > shown && <li className="text-xs text-gray-400">+{data.total - shown} more</li>}
                </ul>
            )}
        </SignalCard>
    );
}

function ReleaseCard({ data }) {
    if (!data.hasRelease) {
        return (
            <SignalCard title="Release">
                <p className="text-xs text-gray-400 italic">No releases or tags yet</p>
            </SignalCard>
        );
    }
    const age = daysSince(data.publishedAt);
    return (
        <SignalCard title="Release" summary={data.source === 'tag' ? 'tag' : 'release'}>
            <div className="text-xs text-gray-700 space-y-1">
                <div>
                    {data.url
                        ? <a href={data.url} target="_blank" rel="noopener noreferrer" className="font-mono font-medium hover:underline">{data.tag}</a>
                        : <span className="font-mono font-medium">{data.tag}</span>}
                    {data.name && data.name !== data.tag && <span className="text-gray-500"> — {data.name}</span>}
                </div>
                <div className="text-gray-500">{age === null ? 'date unknown' : age === 0 ? 'published today' : `published ${age}d ago`}</div>
                <div>
                    {data.unreleasedCommits === null || data.unreleasedCommits === undefined
                        ? <span className="text-gray-400">unreleased commits unknown</span>
                        : data.unreleasedCommits === 0
                            ? <span className="text-green-700">default branch is released</span>
                            : <span className="font-medium">{data.unreleasedCommits} commits not released yet</span>}
                </div>
                {data.downloads > 0 && (
                    <div className="text-gray-500">
                        {data.downloads.toLocaleString('en-US')} downloads
                        {data.latestDownloads > 0 && ` (${data.latestDownloads.toLocaleString('en-US')} of ${data.tag})`}
                    </div>
                )}
            </div>
        </SignalCard>
    );
}

function BranchesCard({ data, onCleanup }) {
    const cleanable = (data.merged || 0) + (data.stale || 0);
    return (
        <SignalCard title="Branches" summary={`${data.total} total`}>
            <ul className="space-y-1 text-xs text-gray-700">
                <li className="flex justify-between gap-4"><span>Merged, not deleted</span><span className="tabular-nums">{data.merged}</span></li>
                <li className="flex justify-between gap-4"><span>Stale (90d+)</span><span className="tabular-nums">{data.stale}</span></li>
                <li className="flex justify-between gap-4"><span>Open PRs</span><span className="tabular-nums">{data.openPrs}</span></li>
            </ul>
            {(data.stalePrs || []).length > 0 && (
                <ul className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                    {data.stalePrs.slice(0, 3).map(pr => (
                        <li key={pr.number} className="text-xs">
                            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:underline">
                                #{pr.number} {pr.title}
                            </a>
                            <span className="text-gray-400"> — idle {daysSince(pr.updatedAt)}d{pr.draft ? ', draft' : ''}</span>
                        </li>
                    ))}
                    {data.stalePrCount > 3 && <li className="text-xs text-gray-400">+{data.stalePrCount - 3} more stale PRs</li>}
                </ul>
            )}
            {cleanable > 0 && onCleanup && (
                <button type="button" onClick={onCleanup} className="mt-2 text-xs text-blue-600 hover:underline">
                    Clean up {cleanable} branches…
                </button>
            )}
            {data.truncated && <p className="mt-1 text-[10px] text-gray-400">Only the first 100 branches were checked.</p>}
        </SignalCard>
    );
}

/** Stacked bars of runs per day (green = passed, red = failed). */
export function CiDailyBars({ daily = [], height = 40 }) {
    const max = Math.max(1, ...daily.map(d => d.success + d.failure));
    return (
        <div className="flex items-end gap-0.5" style={{ height }} role="img" aria-label="Workflow runs per day">
            {daily.map(day => {
                const total = day.success + day.failure;
                return (
                    <div
                        key={day.date}
                        className="flex-1 flex flex-col justify-end h-full min-w-[3px]"
                        title={`${day.date}: ${day.success} passed, ${day.failure} failed`}
                    >
                        {total === 0
                            ? <div className="h-px bg-gray-200" />
                            : (
                                <>
                                    <div className="bg-red-400 rounded-t-sm" style={{ height: `${(day.failure / max) * 100}%` }} />
                                    <div className="bg-green-500" style={{ height: `${(day.success / max) * 100}%` }} />
                                </>
                            )}
                    </div>
                );
            })}
        </div>
    );
}

const rateTone = (rate) => (rate === null ? 'text-gray-400' : rate >= 90 ? 'text-green-700' : rate >= 70 ? 'text-amber-700' : 'text-red-700');

export function CiWorkflowTable({ workflows = [] }) {
    return (
        <table className="w-full text-xs">
            <thead className="text-gray-400">
                <tr>
                    <th className="text-left font-medium py-0.5">Workflow</th>
                    <th className="text-right font-medium">Runs</th>
                    <th className="text-right font-medium">Pass</th>
                    <th className="text-right font-medium">Avg</th>
                    <th className="text-right font-medium">Flaky</th>
                </tr>
            </thead>
            <tbody>
                {workflows.map(wf => (
                    <tr key={wf.name} className="text-gray-700">
                        <td className="py-0.5 pr-2 truncate max-w-[160px]" title={`Last run: ${wf.lastConclusion ?? 'unknown'}`}>
                            {wf.lastUrl
                                ? <a href={wf.lastUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{wf.name}</a>
                                : wf.name}
                        </td>
                        <td className="text-right tabular-nums">{wf.runs}</td>
                        <td className={cn('text-right tabular-nums font-medium', rateTone(wf.successRate))}>
                            {wf.successRate === null ? '-' : `${wf.successRate}%`}
                        </td>
                        <td className="text-right tabular-nums">{formatDuration(wf.avgDurationSec)}</td>
                        <td className={cn('text-right tabular-nums', wf.flaky > 0 && 'text-amber-700 font-medium')}>{wf.flaky}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function CiCard({ data }) {
    if (!data.available) {
        return (
            <SignalCard title="CI">
                <p className="text-xs text-gray-400 italic">Workflow runs are not available for this repo.</p>
            </SignalCard>
        );
    }
    if (data.sampled === 0) {
        return (
            <SignalCard title="CI">
                <p className="text-xs text-gray-400 italic">No workflow runs yet</p>
            </SignalCard>
        );
    }
    return (
        <SignalCard title="CI" summary={`last ${data.sampled}${data.truncated ? '+' : ''} runs · ${data.windowDays}d`}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-gray-600 mb-2 whitespace-nowrap">
                <span><span className={cn('text-base font-semibold tabular-nums', rateTone(data.successRate))}>
                    {data.successRate === null ? '-' : `${data.successRate}%`}
                </span> pass</span>
                <span>avg {formatDuration(data.avgDurationSec)}</span>
                <span>{data.totalMinutes} min run time</span>
                {data.flaky > 0 && <span className="text-amber-700 font-medium">{data.flaky} flaky</span>}
            </div>
            <CiDailyBars daily={data.daily} />
            <div className="mt-2 pt-2 border-t border-gray-100">
                <CiWorkflowTable workflows={(data.workflows || []).slice(0, 4)} />
            </div>
        </SignalCard>
    );
}

const onOff = (value) => (value === null ? 'unknown' : value ? 'on' : 'off');

function ConfigCard({ data, onApply, applying }) {
    const [confirming, setConfirming] = useState(false);
    if (!data.applicable) {
        return (
            <SignalCard title="Settings">
                <p className="text-xs text-gray-400 italic">Archived repo: settings are not checked.</p>
            </SignalCard>
        );
    }
    return (
        <SignalCard title="Settings" summary={data.drift === 0 ? 'matches baseline' : `${data.drift} drift`}>
            <ul className="space-y-1 text-xs">
                {(data.settings || []).map(setting => (
                    <li key={setting.key} className="flex items-start gap-2">
                        <span className="mt-0.5">
                            {setting.actual === null
                                ? <HelpCircle size={14} className="text-gray-300" aria-label="Unknown" />
                                : setting.drift
                                    ? <XCircle size={14} className="text-amber-500" aria-label="Drift" />
                                    : <CheckCircle size={14} className="text-green-500" aria-label="Matches" />}
                        </span>
                        <span className="text-gray-700">
                            {setting.label}
                            <span className={cn('block', setting.drift ? 'text-amber-700' : 'text-gray-400')}>
                                {setting.drift
                                    ? `is ${onOff(setting.actual)}, baseline is ${onOff(setting.expected)}`
                                    : onOff(setting.actual)}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
            {data.unknown > 0 && (
                <p className="mt-2 text-[10px] text-gray-400">
                    Unknown settings: the token has no admin access to this repo.
                </p>
            )}
            {data.drift > 0 && onApply && (
                data.canApply ? (
                    confirming ? (
                        <div className="mt-2 flex items-center gap-3 text-xs">
                            <button
                                type="button"
                                disabled={applying}
                                onClick={async () => { await onApply(); setConfirming(false); }}
                                className="font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                                {applying ? 'Applying...' : `Confirm: change ${data.drift} settings on GitHub`}
                            </button>
                            <button type="button" onClick={() => setConfirming(false)} className="text-gray-500 hover:underline">Cancel</button>
                        </div>
                    ) : (
                        <button type="button" onClick={() => setConfirming(true)} className="mt-2 text-xs text-blue-600 hover:underline">
                            Apply baseline…
                        </button>
                    )
                ) : (
                    <p className="mt-2 text-[10px] text-gray-400">Admin access is required to apply the baseline.</p>
                )
            )}
        </SignalCard>
    );
}

function DependenciesCard({ data }) {
    const today = new Date().toISOString().slice(0, 10);
    const ecosystems = Object.entries(data.ecosystems || {});
    return (
        <SignalCard title="Dependencies" summary={`${data.total} direct`}>
            <ul className="space-y-1 text-xs text-gray-700">
                {ecosystems.map(([name, count]) => (
                    <li key={name} className="flex justify-between gap-4">
                        <span>{name}</span>
                        <span className="tabular-nums text-gray-500">{count}</span>
                    </li>
                ))}
                {ecosystems.length === 0 && <li className="text-gray-400 italic">No supported manifests found</li>}
                {(data.runtimes || []).map(rt => {
                    const eol = rt.eolDate && rt.eolDate <= today;
                    return (
                        <li key={rt.name} className="flex justify-between gap-4 pt-1 border-t border-gray-100">
                            <span>{rt.name} <span className="font-mono">{rt.version}</span></span>
                            <span className={eol ? 'text-red-600 font-medium' : 'text-gray-500'}>
                                {rt.eolDate ? `${eol ? 'EOL' : 'until'} ${rt.eolDate}` : 'EOL unknown'}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </SignalCard>
    );
}

/** Repo signals panel (expanded row): one card per synced signal type. */
export function RepoSignals({ repo, onSync, syncing = false, onCleanupBranches, onApplyConfig, applyingConfig = false }) {
    const signals = repo.signals || {};
    const checkedAt = signalsCheckedAt(repo);
    const hasAny = Object.keys(signals).length > 0;

    return (
        <div className="px-3 pt-3 sticky left-0 max-w-[calc(100vw-3rem)] md:max-w-[calc(100vw-24rem)]">
            <div className="flex items-center gap-3 mb-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Signals</span>
                <span className="text-xs text-gray-400">
                    {checkedAt ? `checked ${new Date(checkedAt).toLocaleDateString()}` : 'never synced'}
                </span>
                {onSync && (
                    <button
                        type="button"
                        onClick={onSync}
                        disabled={syncing}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                        {syncing ? 'Syncing...' : 'Sync signals'}
                    </button>
                )}
                {repo.isPrivate === false && repo.fullName && (
                    <a href={`/embeds?repo=${encodeURIComponent(repo.fullName)}`} className="text-xs text-blue-600 hover:underline">
                        Badges
                    </a>
                )}
            </div>
            {hasAny ? (
                <div className="flex flex-wrap gap-3">
                    {signals.standards?.checks && <StandardsCard data={signals.standards} />}
                    {signals.security && <SecurityCard data={signals.security} />}
                    {signals.ci && <CiCard data={signals.ci} />}
                    {signals.release && <ReleaseCard data={signals.release} />}
                    {signals.branches && <BranchesCard data={signals.branches} onCleanup={onCleanupBranches} />}
                    {signals.config && <ConfigCard data={signals.config} onApply={onApplyConfig} applying={applyingConfig} />}
                    {signals.dependencies && <DependenciesCard data={signals.dependencies} />}
                    {signals.policy?.checks?.length > 0 && <PolicyCard data={signals.policy} />}
                    {signals.vulnerabilities?.enabled && <VulnerabilitiesCard data={signals.vulnerabilities} />}
                    {signals.scorecard?.enabled && <ScorecardCard data={signals.scorecard} repoFullName={repo.fullName} />}
                </div>
            ) : (
                <p className="text-xs text-gray-400 italic">
                    No signals yet. Sync to check repo standards against GitHub.
                </p>
            )}
        </div>
    );
}
