import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/**
 * Uptime history per service ({ slug: { uptimePct, avgMs, incidents, daily } }).
 * Refetched when `refreshKey` changes (e.g. after a health check).
 */
export function useServiceUptime(refreshKey = '', days = 30) {
    const [uptime, setUptime] = useState({});

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await apiFetch(`/api/services/uptime?days=${days}`);
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled) setUptime(data.services || {});
            } catch {
                // The history is optional: without it the table shows only the last check.
            }
        })();
        return () => { cancelled = true; };
    }, [refreshKey, days]);

    return uptime;
}
