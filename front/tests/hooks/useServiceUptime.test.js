import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServiceUptime } from '@/hooks/useServiceUptime';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
const respond = (body, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe('useServiceUptime', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads uptime by service slug', async () => {
        apiFetch.mockReturnValue(respond({ days: 30, services: { api: { uptimePct: 99 } } }));
        const { result } = renderHook(() => useServiceUptime());

        await waitFor(() => expect(result.current).toEqual({ api: { uptimePct: 99 } }));
        expect(apiFetch).toHaveBeenCalledWith('/api/services/uptime?days=30');
    });

    it('refetches when the refresh key changes', async () => {
        apiFetch.mockReturnValue(respond({ services: {} }));
        const { rerender } = renderHook(({ key }) => useServiceUptime(key, 7), { initialProps: { key: 'a' } });
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));

        rerender({ key: 'b' });
        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
        expect(apiFetch).toHaveBeenLastCalledWith('/api/services/uptime?days=7');
    });

    it('stays empty when the request fails, throws, or has no services', async () => {
        apiFetch.mockReturnValueOnce(respond({}, false));
        const failed = renderHook(() => useServiceUptime('a'));
        apiFetch.mockRejectedValueOnce(new Error('offline'));
        const thrown = renderHook(() => useServiceUptime('b'));
        apiFetch.mockReturnValueOnce(respond({}));
        const empty = renderHook(() => useServiceUptime('c'));

        await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3));
        expect(failed.result.current).toEqual({});
        expect(thrown.result.current).toEqual({});
        expect(empty.result.current).toEqual({});
    });

    it('ignores a response that arrives after unmount', async () => {
        let resolve;
        apiFetch.mockReturnValue(new Promise(r => { resolve = r; }));
        const { result, unmount } = renderHook(() => useServiceUptime());
        unmount();
        resolve({ ok: true, json: () => Promise.resolve({ services: { api: {} } }) });
        await Promise.resolve();
        expect(result.current).toEqual({});
    });
});
