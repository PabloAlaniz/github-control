import React from 'react';
import { cn } from '../../../lib/utils';

function dayColor(day) {
    if (day.checks === 0) return 'bg-gray-200';
    const downRatio = day.down / day.checks;
    if (downRatio === 0) return day.degraded > 0 ? 'bg-lime-400' : 'bg-green-500';
    return downRatio >= 0.5 ? 'bg-red-500' : 'bg-amber-400';
}

function dayTitle(day) {
    if (day.checks === 0) return `${day.date}: no checks`;
    const up = Math.round(((day.checks - day.down) / day.checks) * 100);
    return `${day.date}: ${up}% up (${day.checks} checks${day.avgMs !== null ? `, avg ${day.avgMs}ms` : ''})`;
}

const pctTone = (pct) => (pct >= 99.5 ? 'text-green-700' : pct >= 95 ? 'text-amber-700' : 'text-red-700');

/** Uptime of a service: one bar per day, % over the window, average latency and incidents. */
export function UptimeCell({ uptime }) {
    if (!uptime || uptime.checks === 0) {
        return <span className="text-sm text-gray-400">no history</span>;
    }
    return (
        <div className="min-w-[150px]">
            <div className="flex items-end gap-px h-4" role="img" aria-label={`Uptime ${uptime.uptimePct}% over ${uptime.daily.length} days`}>
                {uptime.daily.map(day => (
                    <div key={day.date} title={dayTitle(day)} className={cn('flex-1 h-full rounded-[1px]', dayColor(day))} />
                ))}
            </div>
            <div className="flex items-baseline gap-2 mt-1 text-xs">
                <span className={cn('font-semibold tabular-nums', pctTone(uptime.uptimePct))}>{uptime.uptimePct}%</span>
                {uptime.avgMs !== null && <span className="text-gray-500 tabular-nums">{uptime.avgMs}ms avg</span>}
                {uptime.incidents > 0 && (
                    <span
                        className="text-red-600"
                        title={uptime.lastDownAt ? `Last down: ${new Date(uptime.lastDownAt).toLocaleString()}` : undefined}
                    >
                        {uptime.incidents} incident{uptime.incidents === 1 ? '' : 's'}
                    </span>
                )}
            </div>
        </div>
    );
}
