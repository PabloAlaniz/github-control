import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useSavedViews } from '@/hooks/useSavedViews';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({
    default: { success: vi.fn(), error: vi.fn() },
}));

const ok = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const fail = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });

describe('useSavedViews', () => {
    const views = [{ id: 1, name: 'Stale', query: 'stale=1' }];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads views on mount', async () => {
        apiFetch.mockReturnValue(ok(views));

        const { result } = renderHook(() => useSavedViews());

        await waitFor(() => expect(result.current.views).toEqual(views));
        expect(apiFetch).toHaveBeenCalledWith('/api/saved-views');
    });

    it('stays empty when the endpoint fails or throws', async () => {
        apiFetch.mockReturnValueOnce(fail());
        const first = renderHook(() => useSavedViews());
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
        expect(first.result.current.views).toEqual([]);

        apiFetch.mockRejectedValueOnce(new Error('network'));
        const second = renderHook(() => useSavedViews());
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
        expect(second.result.current.views).toEqual([]);
    });

    it('saves a view and reloads the list', async () => {
        apiFetch.mockReturnValueOnce(ok([]));
        const { result } = renderHook(() => useSavedViews());
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

        apiFetch.mockReturnValueOnce(ok({ success: true })).mockReturnValueOnce(ok(views));
        let saved;
        await act(async () => { saved = await result.current.saveView('Stale', 'stale=1'); });

        expect(saved).toBe(true);
        expect(apiFetch).toHaveBeenCalledWith('/api/saved-views', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ name: 'Stale', query: 'stale=1' }),
        }));
        expect(result.current.views).toEqual(views);
        expect(toast.success).toHaveBeenCalled();
    });

    it('reports a failed save', async () => {
        apiFetch.mockReturnValueOnce(ok([]));
        const { result } = renderHook(() => useSavedViews());
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

        apiFetch.mockReturnValueOnce(fail());
        let saved;
        await act(async () => { saved = await result.current.saveView('X', ''); });

        expect(saved).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Could not save view');
    });

    it('deletes a view and removes it locally', async () => {
        apiFetch.mockReturnValueOnce(ok(views));
        const { result } = renderHook(() => useSavedViews());
        await waitFor(() => expect(result.current.views).toEqual(views));

        apiFetch.mockReturnValueOnce(ok({ success: true }));
        await act(async () => { await result.current.deleteView(1); });

        expect(apiFetch).toHaveBeenCalledWith('/api/saved-views/1', { method: 'DELETE' });
        expect(result.current.views).toEqual([]);
    });

    it('keeps the view when delete fails', async () => {
        apiFetch.mockReturnValueOnce(ok(views));
        const { result } = renderHook(() => useSavedViews());
        await waitFor(() => expect(result.current.views).toEqual(views));

        apiFetch.mockReturnValueOnce(fail());
        let deleted;
        await act(async () => { deleted = await result.current.deleteView(1); });

        expect(deleted).toBe(false);
        expect(result.current.views).toEqual(views);
        expect(toast.error).toHaveBeenCalledWith('Could not delete view');
    });
});
