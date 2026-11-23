import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAlertCount } from '@/hooks/useAlertCount';
import * as api from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
const respond = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('useAlertCount', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reads how many alerts are open and can refresh', async () => {
        api.apiFetch.mockReturnValueOnce(respond({ open: 3 })).mockReturnValueOnce(respond({ open: 1 }));
        const { result } = renderHook(() => useAlertCount());

        expect(result.current.count).toBeNull();
        await waitFor(() => expect(result.current.count).toBe(3));
        expect(api.apiFetch).toHaveBeenCalledWith('/api/alerts?limit=1');

        await act(() => result.current.refresh());
        expect(result.current.count).toBe(1);
    });

    it('stays unknown when the server refuses or the request fails', async () => {
        api.apiFetch.mockReturnValueOnce(respond({ error: 'no' }, false)).mockRejectedValueOnce(new Error('offline'));
        const { result } = renderHook(() => useAlertCount());

        await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(1));
        await act(() => result.current.refresh());
        expect(result.current.count).toBeNull();
    });
});
