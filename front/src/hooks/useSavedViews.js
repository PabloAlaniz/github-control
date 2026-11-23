import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { apiFetch } from '../lib/api';

/** Saved views: named tab + filter combinations, persisted in the backend. */
export function useSavedViews() {
    const [views, setViews] = useState([]);

    const fetchViews = useCallback(async () => {
        try {
            const res = await apiFetch('/api/saved-views');
            if (!res.ok) return;
            const data = await res.json();
            setViews(Array.isArray(data) ? data : []);
        } catch {
            // Views are optional: if the endpoint fails, the dashboard keeps working.
        }
    }, []);

    useEffect(() => { fetchViews(); }, [fetchViews]);

    const saveView = useCallback(async (name, query) => {
        try {
            const res = await apiFetch('/api/saved-views', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, query }),
            });
            if (!res.ok) throw new Error('save failed');
            toast.success(`View "${name}" saved`);
            await fetchViews();
            return true;
        } catch {
            toast.error('Could not save view');
            return false;
        }
    }, [fetchViews]);

    const deleteView = useCallback(async (id) => {
        try {
            const res = await apiFetch(`/api/saved-views/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('delete failed');
            setViews(prev => prev.filter(v => v.id !== id));
            return true;
        } catch {
            toast.error('Could not delete view');
            return false;
        }
    }, []);

    return { views, fetchViews, saveView, deleteView };
}
