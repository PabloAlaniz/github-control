import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullSync } from '@/hooks/useFullSync';

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args) => mockApiFetch(...args) }));

const ok = (body) => ({ ok: true, json: async () => body });
const idle = { running: false, progress: null, lastRun: null };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useFullSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });
    afterEach(() => vi.useRealTimers());

    it('starts a sync, follows its progress and reports when it finishes', async () => {
        const lastRun = { repos: { total: 3, synced: 3, failed: 0 } };
        mockApiFetch
            .mockResolvedValueOnce(ok(idle))                                                         // status on mount
            .mockResolvedValueOnce(ok({ started: true, running: true, progress: null, lastRun: null })) // POST
            .mockResolvedValueOnce(ok({ running: true, progress: { phase: 'syncing', done: 1, total: 3 }, lastRun: null }))
            .mockResolvedValueOnce(ok({ running: false, progress: null, lastRun }));
        const onFinished = vi.fn();
        const { result } = renderHook(() => useFullSync(onFinished));
        await flush();
        expect(result.current.running).toBe(false);

        await act(async () => { await result.current.start(); });
        expect(mockApiFetch).toHaveBeenLastCalledWith('/api/sync', { method: 'POST' });
        expect(result.current.running).toBe(true);

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(result.current.progress).toEqual({ phase: 'syncing', done: 1, total: 3 });
        expect(onFinished).not.toHaveBeenCalled();

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(result.current.running).toBe(false);
        expect(result.current.lastRun).toEqual(lastRun);
        expect(onFinished).toHaveBeenCalledWith(lastRun);

        await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
        expect(mockApiFetch).toHaveBeenCalledTimes(4); // polling stopped
    });

    it('picks up a sync that was already running', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok({ running: true, progress: { phase: 'syncing', done: 5, total: 9 }, lastRun: null }))
            .mockResolvedValueOnce(ok({ running: false, progress: null, lastRun: { repos: { total: 9, synced: 9, failed: 0 } } }));
        const onFinished = vi.fn();
        const { result } = renderHook(() => useFullSync(onFinished));
        await flush();
        expect(result.current.running).toBe(true);

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(onFinished).toHaveBeenCalledTimes(1);
    });

    it('surfaces a sync that could not start or that failed', async () => {
        mockApiFetch
            .mockResolvedValueOnce(ok(idle))
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'GITHUB_TOKEN is not configured' }) });
        const { result } = renderHook(() => useFullSync());
        await flush();
        await act(async () => { await result.current.start(); });
        expect(result.current.error).toBe('GITHUB_TOKEN is not configured');
        expect(result.current.running).toBe(false);

        mockApiFetch
            .mockResolvedValueOnce(ok({ started: true, running: true, progress: null, lastRun: null }))
            .mockResolvedValueOnce(ok({ running: false, progress: null, lastRun: { error: 'Bad credentials', repos: { total: 0, synced: 0, failed: 0 } } }));
        await act(async () => { await result.current.start(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(result.current.error).toBe('Bad credentials');
    });
});
