import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Bell, BellOff, CheckCircle2, ExternalLink, Pencil, Plus, RefreshCw, Send, Trash2,
} from 'lucide-react';
import { DashboardLayout } from '../components/templates/DashboardLayout';
import { Card } from '../components/atoms/Card';
import { Text } from '../components/atoms/Text';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { Select } from '../components/atoms/Select';
import { Checkbox } from '../components/atoms/Checkbox';
import { ErrorState } from '../components/molecules/ErrorState';
import { apiFetch } from '../lib/api';
import { formatTimeAgo } from '../lib/formatters';
import { cn } from '../lib/utils';

const KIND_TONES = {
    ci_failing: 'bg-red-50 text-red-700 border-red-200',
    service_down: 'bg-red-50 text-red-700 border-red-200',
    security: 'bg-orange-50 text-orange-700 border-orange-200',
    repo_stale: 'bg-amber-50 text-amber-700 border-amber-200',
    health_low: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    custom: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};
const DIGEST_LABELS = { off: 'No digest', daily: 'Daily digest', weekly: 'Weekly digest' };
const RESOLVED_SHOWN = 20;

async function readJson(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const fieldErrors = Object.values(body.details?.fieldErrors ?? {}).flat();
        throw new Error([body.error, ...fieldErrors].filter(Boolean).join(': ') || `Request failed (${res.status})`);
    }
    return body;
}

function KindBadge({ kind, labels }) {
    return (
        <span className={cn('inline-flex flex-shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium', KIND_TONES[kind] || 'bg-gray-100 text-gray-700 border-gray-200')}>
            {labels[kind] || kind}
        </span>
    );
}

function AlertRow({ alert, labels }) {
    const resolved = alert.status === 'resolved';
    return (
        <li className="flex items-start gap-3 px-4 py-3">
            <KindBadge kind={alert.kind} labels={labels} />
            <div className="min-w-0 flex-1">
                <p className={cn('text-sm', resolved ? 'text-gray-500' : 'text-gray-900')}>
                    {alert.url ? (
                        <a href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                            {alert.title}
                            <ExternalLink size={12} className="flex-shrink-0 text-gray-400" />
                        </a>
                    ) : alert.title}
                </p>
                {!resolved && Array.isArray(alert.detail?.top) && alert.detail.top.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                        {alert.detail.top.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                )}
            </div>
            <span className="flex-shrink-0 text-xs text-gray-400" title={resolved ? alert.resolved_at : alert.opened_at}>
                {resolved ? `resolved ${formatTimeAgo(alert.resolved_at)}` : formatTimeAgo(alert.opened_at)}
            </span>
        </li>
    );
}

const emptyForm = (types) => ({ name: '', type: types[0]?.type ?? 'webhook', config: {}, kinds: [], is_enabled: true, digest: 'off' });

function ChannelForm({ channel, types, kinds, onSaved, onCancel }) {
    const [form, setForm] = useState(() => (channel
        ? { name: channel.name, type: channel.type, config: {}, kinds: channel.kinds, is_enabled: channel.is_enabled, digest: channel.digest }
        : emptyForm(types)));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const type = types.find((t) => t.type === form.type);
    const sameType = channel && channel.type === form.type;
    const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
    const toggleKind = (kind) => set({
        kinds: form.kinds.includes(kind) ? form.kinds.filter((k) => k !== kind) : [...form.kinds, kind],
    });

    const submit = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await apiFetch(channel ? `/api/alerts/channels/${channel.id}` : '/api/alerts/channels', {
                method: channel ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            await readJson(res);
            onSaved();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4 border-t border-gray-100 p-4" aria-label={channel ? `Edit ${channel.name}` : 'New channel'}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                    <label htmlFor="channel-name" className="text-sm font-medium text-gray-700">Name</label>
                    <Input id="channel-name" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Team chat" required maxLength={80} />
                </div>
                <div className="space-y-1">
                    <label htmlFor="channel-type" className="text-sm font-medium text-gray-700">Type</label>
                    <Select id="channel-type" value={form.type} onChange={(e) => set({ type: e.target.value, config: {} })}>
                        {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                    </Select>
                </div>
                {type?.fields.map((field) => {
                    const stored = sameType ? channel.config[field.key] : undefined;
                    return (
                        <div key={field.key} className="space-y-1 md:col-span-2">
                            <label htmlFor={`channel-${field.key}`} className="text-sm font-medium text-gray-700">
                                {field.label}{field.optional && <span className="font-normal text-gray-400"> (optional)</span>}
                            </label>
                            <Input
                                id={`channel-${field.key}`}
                                type={field.secret ? 'password' : 'text'}
                                autoComplete="off"
                                value={form.config[field.key] ?? (field.secret ? '' : stored ?? '')}
                                onChange={(e) => set({ config: { ...form.config, [field.key]: e.target.value } })}
                                placeholder={field.secret && stored ? `${stored} (leave empty to keep)` : field.placeholder}
                                required={!field.optional && !(field.secret && stored)}
                            />
                        </div>
                    );
                })}
            </div>

            <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-gray-700">Send</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {kinds.map(({ kind, label }) => (
                        <Checkbox key={kind} label={label} checked={form.kinds.length === 0 || form.kinds.includes(kind)}
                            onChange={() => (form.kinds.length === 0
                                ? set({ kinds: kinds.map((k) => k.kind).filter((k) => k !== kind) })
                                : toggleKind(kind))} />
                    ))}
                </div>
                <p className="text-xs text-gray-500">With every box ticked, kinds added in the future are sent too.</p>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
                <div className="w-44">
                    <Select value={form.digest} onChange={(e) => set({ digest: e.target.value })} aria-label="Digest">
                        {Object.entries(DIGEST_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                </div>
                <Checkbox label="Enabled" checked={form.is_enabled} onChange={(e) => set({ is_enabled: e.target.checked })} />
                <div className="ml-auto flex gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
                    <Button type="submit" disabled={saving}>{saving ? 'Saving…' : channel ? 'Save' : 'Add channel'}</Button>
                </div>
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </form>
    );
}

function ChannelRow({ channel, types, kinds, onEdit, onChanged }) {
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const typeLabel = types.find((t) => t.type === channel.type)?.label ?? channel.type;
    const kindText = channel.kinds.length === 0
        ? 'Everything'
        : channel.kinds.map((kind) => kinds.find((k) => k.kind === kind)?.label ?? kind).join(', ');

    const test = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const body = await readJson(await apiFetch(`/api/alerts/channels/${channel.id}/test`, { method: 'POST' }));
            setTestResult(body.ok ? { ok: true, text: 'Test message sent' } : { ok: false, text: body.error });
            onChanged();
        } catch (err) {
            setTestResult({ ok: false, text: err.message });
        } finally {
            setTesting(false);
        }
    };

    const remove = async () => {
        if (!window.confirm(`Delete the channel "${channel.name}"?`)) return;
        try {
            await readJson(await apiFetch(`/api/alerts/channels/${channel.id}`, { method: 'DELETE' }));
            onChanged();
        } catch (err) {
            setTestResult({ ok: false, text: err.message });
        }
    };

    const failure = testResult && !testResult.ok ? testResult.text : (!testResult && channel.last_error) || null;

    return (
        <li className="px-4 py-3">
            <div className="flex items-center gap-3">
                {channel.is_enabled ? <Bell size={16} className="flex-shrink-0 text-green-600" /> : <BellOff size={16} className="flex-shrink-0 text-gray-400" />}
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                        {channel.name} <span className="font-normal text-gray-500">· {typeLabel}{!channel.is_enabled && ' · disabled'}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                        {kindText} · {DIGEST_LABELS[channel.digest]}
                        {channel.last_sent_at && ` · last sent ${formatTimeAgo(channel.last_sent_at)}`}
                    </p>
                </div>
                <Button variant="ghost" size="sm" onClick={test} disabled={testing} className="gap-1.5" title="Send a test message">
                    <Send size={14} />{testing ? 'Sending…' : 'Test'}
                </Button>
                <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${channel.name}`}><Pencil size={14} /></Button>
                <Button variant="ghost" size="sm" onClick={remove} aria-label={`Delete ${channel.name}`} className="text-red-600"><Trash2 size={14} /></Button>
            </div>
            {failure && <p role="alert" className="mt-1 pl-7 text-xs text-red-600">Last delivery failed: {failure}</p>}
            {testResult?.ok && <p role="status" className="mt-1 pl-7 text-xs text-green-600">{testResult.text}</p>}
        </li>
    );
}

function rulesText(rules) {
    if (!rules) return '';
    const parts = ['CI failing', 'a service down', 'critical or high security alerts'];
    if (rules.staleDays > 0) parts.push(`high or medium priority repos without commits for ${rules.staleDays} days`);
    if (rules.healthBelow > 0) parts.push(`a health score under ${rules.healthBelow}`);
    if (rules.custom > 0) parts.push(`${rules.custom} rule${rules.custom === 1 ? '' : 's'} of the policy`);
    return `Alerts open for: ${parts.join(', ')}.`;
}

/** What needs attention right now, what was resolved lately and where alerts are sent. */
export function AlertsPage() {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [channelData, setChannelData] = useState(null);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null);   // null | 'new' | channel id
    const [evaluating, setEvaluating] = useState(false);

    const load = useCallback(async () => {
        setError(null);
        try {
            const [alerts, channels] = await Promise.all([
                apiFetch('/api/alerts?status=all').then(readJson),
                apiFetch('/api/alerts/channels').then(readJson),
            ]);
            setData(alerts);
            setChannelData(channels);
        } catch (err) {
            setError(err.message);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const evaluate = async () => {
        setEvaluating(true);
        try {
            await apiFetch('/api/alerts/evaluate', { method: 'POST' });
            await load();
        } finally {
            setEvaluating(false);
        }
    };

    if (error) return <ErrorState variant="page" message={error} onRetry={load} />;

    const alerts = data?.alerts ?? [];
    const labels = data?.kinds ?? {};
    const open = alerts.filter((alert) => alert.status === 'open');
    const resolved = alerts.filter((alert) => alert.status === 'resolved');
    const channels = channelData?.channels ?? [];
    const types = channelData?.types ?? [];
    const kinds = channelData?.kinds ?? [];
    const closeForm = () => { setEditing(null); load(); };

    return (
        <DashboardLayout
            stats={
                <header className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate('/')} className="gap-2">
                        <ArrowLeft size={16} />
                        Back
                    </Button>
                    <div className="flex-1">
                        <Text variant="h2">Alerts</Text>
                        <Text variant="muted">{rulesText(data?.rules) || 'What needs attention across your repos and services'}</Text>
                    </div>
                    <Button variant="outline" onClick={evaluate} disabled={evaluating} className="gap-2" title="Check again from the data already synced">
                        <RefreshCw size={16} className={evaluating ? 'animate-spin' : ''} />
                        Check now
                    </Button>
                </header>
            }
        >
            {!data || !channelData ? (
                <Text variant="muted">Loading...</Text>
            ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
                    <div className="space-y-6 xl:col-span-3">
                        <Card className="overflow-hidden">
                            <div className="border-b border-gray-100 px-4 py-3">
                                <h3 className="text-sm font-semibold text-gray-900">Open <span className="font-normal text-gray-500">({open.length})</span></h3>
                            </div>
                            {open.length === 0 ? (
                                <div className="flex items-center gap-2 px-4 py-6 text-sm text-gray-500">
                                    <CheckCircle2 size={16} className="text-green-600" />
                                    Nothing needs attention.
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {open.map((alert) => <AlertRow key={alert.id} alert={alert} labels={labels} />)}
                                </ul>
                            )}
                        </Card>

                        {resolved.length > 0 && (
                            <Card className="overflow-hidden">
                                <div className="border-b border-gray-100 px-4 py-3">
                                    <h3 className="text-sm font-semibold text-gray-900">Recently resolved</h3>
                                </div>
                                <ul className="divide-y divide-gray-100">
                                    {resolved.slice(0, RESOLVED_SHOWN).map((alert) => <AlertRow key={alert.id} alert={alert} labels={labels} />)}
                                </ul>
                            </Card>
                        )}
                    </div>

                    <Card className="h-fit overflow-hidden xl:col-span-2">
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-900">Channels</h3>
                                <Text variant="muted" className="text-xs">Where alerts are sent when they open, get worse or are resolved</Text>
                            </div>
                            {editing === null && (
                                <Button variant="outline" size="sm" onClick={() => setEditing('new')} className="gap-1.5">
                                    <Plus size={14} />Add channel
                                </Button>
                            )}
                        </div>
                        {channels.length === 0 && editing === null && (
                            <p className="px-4 py-6 text-sm text-gray-500">
                                No channels yet. Alerts are still listed here; add a channel to get them by email, in Slack, Discord, Telegram or ntfy, or on any webhook.
                            </p>
                        )}
                        <ul className="divide-y divide-gray-100">
                            {channels.map((channel) => (editing === channel.id ? (
                                <li key={channel.id}>
                                    <ChannelForm channel={channel} types={types} kinds={kinds} onSaved={closeForm} onCancel={() => setEditing(null)} />
                                </li>
                            ) : (
                                <ChannelRow key={channel.id} channel={channel} types={types} kinds={kinds}
                                    onEdit={() => setEditing(channel.id)} onChanged={load} />
                            )))}
                        </ul>
                        {editing === 'new' && (
                            <ChannelForm types={types} kinds={kinds} onSaved={closeForm} onCancel={() => setEditing(null)} />
                        )}
                    </Card>
                </div>
            )}
        </DashboardLayout>
    );
}
