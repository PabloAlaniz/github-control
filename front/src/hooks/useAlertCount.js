import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const CHANGED = 'ghc:alerts-changed';

/** Tell whoever shows the count that alerts may have changed (after a sync, a check, a policy change). */
export function alertsChanged() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

/** How many alerts are open, for the navigation. Null until known (or when it cannot be read). */
export function useAlertCount() {
    const [count, setCount] = useState(null);

    const refresh = useCallback(async () => {
        try {
            const res = await apiFetch('/api/alerts?limit=1');
            if (!res.ok) return;
            const body = await res.json();
            setCount(typeof body.open === 'number' ? body.open : null);
        } catch {
            // The count is a convenience: the app works without it.
        }
    }, []);

    useEffect(() => {
        refresh();
        window.addEventListener(CHANGED, refresh);
        return () => window.removeEventListener(CHANGED, refresh);
    }, [refresh]);

    return { count, refresh };
}
