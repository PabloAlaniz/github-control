import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

/** How many alerts are open, for the header. Null until known (or when it cannot be read). */
export function useAlertCount() {
    const [count, setCount] = useState(null);

    const refresh = useCallback(async () => {
        try {
            const res = await apiFetch('/api/alerts?limit=1');
            if (!res.ok) return;
            const body = await res.json();
            setCount(typeof body.open === 'number' ? body.open : null);
        } catch {
            // The count is a convenience: the dashboard works without it.
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    return { count, refresh };
}
