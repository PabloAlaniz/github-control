import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

const POLL_MS = 2000;
const IDLE = { running: false, progress: null, lastRun: null };

/**
 * Drives the server's full sync: start it, follow its progress and call
 * `onFinished` when a run completes. Also picks up a sync that is already
 * running (for example the one started right after setup).
 */
export function useFullSync(onFinished) {
    const [status, setStatus] = useState(IDLE);
    const [error, setError] = useState('');
    const timer = useRef(null);
    const wasRunning = useRef(false);
    const finished = useRef(onFinished);
    finished.current = onFinished;

    const poll = useCallback(async () => {
        try {
            const res = await apiFetch('/api/sync/status');
            if (!res.ok) return;
            const next = await res.json();
            setStatus(next);
            if (next.running) {
                wasRunning.current = true;
                timer.current = setTimeout(poll, POLL_MS);
            } else if (wasRunning.current) {
                wasRunning.current = false;
                if (next.lastRun?.error) setError(next.lastRun.error);
                finished.current?.(next.lastRun);
            }
        } catch {
            // A failed poll is not worth surfacing; the next action will retry.
        }
    }, []);

    useEffect(() => {
        poll();
        return () => clearTimeout(timer.current);
    }, [poll]);

    const start = useCallback(async () => {
        setError('');
        try {
            const res = await apiFetch('/api/sync', { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Could not start the sync');
            wasRunning.current = true;
            setStatus({ running: true, progress: body.progress ?? null, lastRun: body.lastRun ?? null });
            clearTimeout(timer.current);
            timer.current = setTimeout(poll, POLL_MS);
        } catch (err) {
            setError(err.message);
        }
    }, [poll]);

    return { ...status, error, start };
}
