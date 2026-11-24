import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Info, Loader2, Save, TriangleAlert } from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';

const SOURCE_NOTES = {
    file: 'This policy is read from the file POLICY_FILE points to. Change that file (it is picked up within seconds); here you can preview a change.',
    env: 'This policy is set by the POLICY environment variable. Change it there; here you can preview a change.',
    saved: 'Saved from this page.',
    default: 'No policy yet: these are the defaults. Edit and apply to start one.',
};
const SECTION_LABELS = {
    baseline: 'Settings baseline', 'health.weights': 'Health weight', 'health.checks': 'Custom check', alerts: 'Alert threshold',
    'alerts.rules': 'Alert rule', signals: 'Signal',
};

const show = (value) => {
    if (value === null || value === undefined) return 'not set';
    if (typeof value === 'object') return value.label ?? JSON.stringify(value);
    return String(value);
};

function changeText(change) {
    if (change.section === 'health.checks' || change.section === 'alerts.rules') {
        if (change.from === null) return <>added <b>{change.key}</b> ({show(change.to)})</>;
        if (change.to === null) return <>removed <b>{change.key}</b></>;
        return <>changed <b>{change.key}</b></>;
    }
    return <><b>{change.key}</b>: {show(change.from)} <ArrowRight size={12} className="inline" /> {show(change.to)}</>;
}

const delta = (before, after) => {
    if (before === null || after === null) return null;
    const diff = after - before;
    return diff === 0 ? null : (diff > 0 ? `+${diff}` : String(diff));
};

function Figure({ label, before, after, lowerIsBetter = false }) {
    const diff = delta(before, after);
    const good = diff && (diff.startsWith('+') !== lowerIsBetter);
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-gray-900">
                {after ?? '–'}
                {diff && <span className={cn('ml-1.5 text-xs font-medium', good ? 'text-green-600' : 'text-red-600')}>{diff}</span>}
            </dd>
        </div>
    );
}

function Plan({ plan }) {
    if (!plan.valid) {
        return (
            <div role="alert" className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-red-700"><TriangleAlert size={16} />Not a valid policy</p>
                <ul className="list-disc space-y-1 pl-6 text-sm text-red-700">
                    {plan.errors.map((error) => <li key={error}>{error}</li>)}
                </ul>
            </div>
        );
    }
    const { impact } = plan;
    return (
        <div className="divide-y divide-gray-100">
            <div className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">What changes</h4>
                {plan.changes.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-gray-600"><CheckCircle2 size={16} className="text-green-600" />Nothing: this is the policy already in force.</p>
                ) : (
                    <ul className="space-y-1 text-sm text-gray-800">
                        {plan.changes.map((change) => (
                            <li key={`${change.section}.${change.key}`}>
                                <span className="text-gray-500">{SECTION_LABELS[change.section] ?? change.section} · </span>
                                {changeText(change)}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">What it would do to {impact.repos} repos</h4>
                <dl className="grid grid-cols-3 gap-4">
                    <Figure label="Average health" before={impact.averageBefore} after={impact.averageAfter} />
                    <Figure label="Settings out of line" before={impact.driftBefore} after={impact.driftAfter} lowerIsBetter />
                    <Figure label="Alerts that would be open" before={impact.alertsBefore} after={impact.alertsAfter} lowerIsBetter />
                </dl>
                <p className="mt-2 text-xs text-gray-500">{impact.scoreUp} repos score higher, {impact.scoreDown} lower.</p>
            </div>

            {impact.affected.length > 0 && (
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                        <tr>
                            <th className="px-4 py-2 text-left font-semibold">Repo</th>
                            <th className="px-4 py-2 text-right font-semibold">Health</th>
                            <th className="px-4 py-2 text-right font-semibold">Settings drift</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {impact.affected.map((repo) => (
                            <tr key={repo.repo}>
                                <td className="px-4 py-2 text-gray-900">{repo.repo}</td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                                    {repo.scoreBefore === repo.scoreAfter ? repo.scoreAfter : <>{repo.scoreBefore} <ArrowRight size={12} className="inline text-gray-400" /> <b>{repo.scoreAfter}</b></>}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                                    {repo.driftAfter === null ? '–' : repo.driftBefore === repo.driftAfter ? repo.driftAfter : <>{repo.driftBefore ?? '–'} <ArrowRight size={12} className="inline text-gray-400" /> <b>{repo.driftAfter}</b></>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {plan.notes.length > 0 && (
                <ul className="space-y-1.5 p-4 text-xs text-gray-600">
                    {plan.notes.map((note) => <li key={note} className="flex gap-2"><Info size={14} className="mt-0.5 flex-shrink-0 text-blue-500" />{note}</li>)}
                </ul>
            )}
        </div>
    );
}

/** The policy as a document: edit it, see what a change would do, then apply it. */
export function PolicyPage() {
    const navigate = useNavigate();
    const [policy, setPolicy] = useState(null);
    const [text, setText] = useState('');
    const [plan, setPlan] = useState(null);
    const [planned, setPlanned] = useState(null);   // the text the plan on screen is about
    const [busy, setBusy] = useState(null);         // null | 'plan' | 'apply'
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);

    const adopt = (next) => {
        setPolicy(next);
        // Show the document as written; with none yet, the complete defaults are the place to start.
        setText(next.text || next.yaml);
    };

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await apiFetch('/api/policy');
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
            adopt(body);
        } catch (err) {
            setError(err.message);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const send = async (action) => {
        setBusy(action);
        setMessage(null);
        try {
            const res = await apiFetch(action === 'apply' ? '/api/policy' : '/api/policy/plan', {
                method: action === 'apply' ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ yaml: text }),
            });
            const body = await res.json().catch(() => ({}));
            if (typeof body.valid !== 'boolean') throw new Error(body.error || `Request failed (${res.status})`);
            setPlan(body);
            setPlanned(text);
            if (body.applied) {
                setPolicy(body.policy);
                setMessage({ ok: true, text: 'Applied. Settings drift and new checks are refreshed by the next sync.' });
            }
        } catch (err) {
            setMessage({ ok: false, text: err.message });
        } finally {
            setBusy(null);
        }
    };

    if (error) return <ErrorState variant="page" message={error} onRetry={load} />;

    // Applying is offered only for the exact text that was previewed, and only when it changes something.
    const previewed = plan?.valid && planned === text;
    const canApply = policy?.editable && previewed && plan.changes.length > 0 && !plan.applied;

    return (
        <DashboardLayout
            stats={
                <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                        <ArrowLeft size={16} />
                        Back
                    </Button>
                    <div className="min-w-48 flex-1">
                        <Text variant="h2">Policy</Text>
                        <Text variant="muted">What every repo is expected to have: settings, what counts for health, and when to alert</Text>
                    </div>
                </header>
            }
        >
            {!policy ? (
                <Text variant="muted">Loading...</Text>
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <Card className="overflow-hidden">
                        <div className="border-b border-gray-100 px-4 py-3">
                            <h3 className="text-sm font-semibold text-gray-900">Document</h3>
                            <Text variant="muted" className="text-xs">{SOURCE_NOTES[policy.source]}</Text>
                        </div>
                        {policy.errors.length > 0 && (
                            <p role="alert" className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
                                The stored policy is not valid, so the defaults are in force: {policy.errors.join('; ')}
                            </p>
                        )}
                        <textarea
                            value={text}
                            onChange={(e) => { setText(e.target.value); setMessage(null); }}
                            spellCheck={false}
                            aria-label="Policy document (YAML)"
                            className="block h-[30rem] w-full resize-y bg-white p-4 font-mono text-xs leading-relaxed text-gray-800 focus:outline-none"
                        />
                        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-3">
                            <Button variant="outline" onClick={() => send('plan')} disabled={busy !== null} className="gap-2">
                                {busy === 'plan' ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                                Preview changes
                            </Button>
                            {policy.editable && (
                                <Button onClick={() => send('apply')} disabled={!canApply || busy !== null} className="gap-2"
                                    title={canApply ? undefined : 'Preview the changes first'}>
                                    {busy === 'apply' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                    Apply
                                </Button>
                            )}
                            {message && (
                                <span role={message.ok ? 'status' : 'alert'} className={cn('text-sm', message.ok ? 'text-green-600' : 'text-red-600')}>{message.text}</span>
                            )}
                        </div>
                    </Card>

                    <Card className="h-fit overflow-hidden">
                        <div className="border-b border-gray-100 px-4 py-3">
                            <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
                            <Text variant="muted" className="text-xs">Computed from what the last sync stored. Nothing changes until you apply.</Text>
                        </div>
                        {!plan ? (
                            <p className="px-4 py-8 text-sm text-gray-500">Edit the document and press “Preview changes” to see what it would do.</p>
                        ) : (
                            <>
                                {plan.valid && planned !== text && (
                                    <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">The document changed since this preview.</p>
                                )}
                                <Plan plan={plan} />
                            </>
                        )}
                    </Card>
                </div>
            )}
        </DashboardLayout>
    );
}
