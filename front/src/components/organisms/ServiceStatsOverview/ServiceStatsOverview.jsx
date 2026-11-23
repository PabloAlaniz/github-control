import React from 'react';
import { StatCard } from '../../molecules/StatCard';
import { Server, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export function ServiceStatsOverview({ services }) {
    const total = services.length;
    const healthy = services.filter(s => s.lastCheckStatus === 'healthy').length;
    const degraded = services.filter(s => s.lastCheckStatus === 'degraded').length;
    const down = services.filter(s => s.lastCheckStatus === 'down').length;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total" value={total} icon={Server} />
            <StatCard label="Healthy" value={healthy} variant="success" icon={CheckCircle} />
            <StatCard label="Degraded" value={degraded} variant="warning" icon={AlertTriangle} />
            <StatCard label="Down" value={down} variant="danger" icon={XCircle} />
        </div>
    );
}
