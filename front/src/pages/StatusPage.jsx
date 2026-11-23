import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import { formatTimeAgo } from '../lib/formatters';
import { cn } from '../lib/utils';

const API_BASE = import.meta.env.VITE_API_URL || '';
const REFRESH_MS = 60_000;

const OVERALL = {
    operational: { text: 'All systems operational', icon: CheckCircle2, tone: 'bg-green-50 text-green-800 border-green-200' },
    degraded: { text: 'Some systems are degraded', icon: AlertTriangle, tone: 'bg-amber-50 text-amber-800 border-amber-200' },
    outage: { text: 'Some systems are down', icon: XCircle, tone: 'bg-red-50 text-red-800 border-red-200' },
    unknown: { text: 'No checks yet', icon: HelpCircle, tone: 'bg-gray-100 text-gray-700 border-gray-200' },
};
const SERVICE = {
    healthy: { text: 'Operational', tone: 'text-green-700' },
    degraded: { text: 'Degraded', tone: 'text-amber-700' },
    down: { text: 'Down', tone: 'text-red-700' },
    unknown: { text: 'Not checked yet', tone: 'text-gray-500' },
};

function dayTone(day) {
    if (day.checks === 0) return 'bg-gray-200';
    if (day.down > 0) return day.down / day.checks > 0.1 ? 'bg-red-500' : 'bg-orange-400';
    // One slow answer does not make a bad day.
    if (day.degraded / day.checks > 0.1) return 'bg-yellow-400';
    return 'bg-green-500';
}

function dayTitle(day) {
    if (day.checks === 0) return `${day.date}: no data`;
    if (day.down > 0) return `${day.date}: down in ${day.down} of ${day.checks} checks`;
    if (day.degraded > 0) return `${day.date}: degraded in ${day.degraded} of ${day.checks} checks`;
    return `${day.date}: no problems`;
}

function ServiceRow({ service, days }) {
    const state = SERVICE[service.status] ?? SERVICE.unknown;
    return (
        <li className="px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">{service.name}</h2>
                <span className={cn('text-sm font-medium', state.tone)}>{state.text}</span>
            </div>
            <div className="mt-2 flex h-8 gap-px" role="img" aria-label={`${service.name}: daily status for the last ${days} days`}>
                {service.daily.map((day) => (
                    <span key={day.date} title={dayTitle(day)} className={cn('flex-1 rounded-sm', dayTone(day))} />
                ))}
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-gray-500">
                <span>{days} days ago</span>
                <span>{service.uptimePct === null ? 'no data yet' : `${service.uptimePct}% uptime`}</span>
                <span>today</span>
            </div>
        </li>
    );
}

/** Public status page: what is up, what is not, and the last 90 days. No sign-in. */
export function StatusPage() {
    const [status, setStatus] = useState(null);
    const [state, setState] = useState('loading');   // loading | ready | disabled | error

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/status`);
                if (!active) return;
                if (res.status === 404) { setState('disabled'); return; }
                if (!res.ok) throw new Error(String(res.status));
                setStatus(await res.json());
                setState('ready');
            } catch {
                // Keep what is on screen if a refresh fails.
                if (active) setState((current) => (current === 'ready' ? current : 'error'));
            }
        };
        load();
        const timer = setInterval(load, REFRESH_MS);
        return () => { active = false; clearInterval(timer); };
    }, []);

    const overall = OVERALL[status?.overall] ?? OVERALL.unknown;
    const Icon = overall.icon;

    return (
        <div className="min-h-screen bg-gray-50 px-4 py-10">
            <main className="mx-auto max-w-3xl space-y-6">
                <h1 className="text-2xl font-semibold text-gray-900">Status</h1>

                {state === 'loading' && <p className="text-sm text-gray-500">Loading...</p>}
                {state === 'disabled' && <p className="text-sm text-gray-600">This status page is not enabled.</p>}
                {state === 'error' && <p role="alert" className="text-sm text-red-600">The status could not be loaded. Try again in a moment.</p>}

                {state === 'ready' && (
                    <>
                        <div className={cn('flex items-center gap-3 rounded-lg border px-5 py-4 text-base font-medium', overall.tone)} role="status">
                            <Icon size={20} className="flex-shrink-0" />
                            {overall.text}
                        </div>

                        {status.services.length === 0 ? (
                            <p className="text-sm text-gray-600">No services are being monitored yet.</p>
                        ) : (
                            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
                                {status.services.map((service) => <ServiceRow key={service.slug} service={service} days={status.days} />)}
                            </ul>
                        )}

                        <p className="text-xs text-gray-400">
                            Updated {formatTimeAgo(status.updatedAt)} · refreshes every minute · powered by{' '}
                            <a href="https://github.com/PabloAlaniz/github-control" className="underline">GitHub Control</a>
                        </p>
                    </>
                )}
            </main>
        </div>
    );
}
