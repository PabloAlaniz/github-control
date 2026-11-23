import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useServices } from '@/hooks/useServices';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
    apiFetch: vi.fn(),
}));

describe('useServices', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('has correct initial state', () => {
        const { result } = renderHook(() => useServices());

        expect(result.current.loading).toBe(true);
        expect(result.current.services).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it('fetchServices - success case, sets services with mapped fields', async () => {
        const apiResponse = [
            {
                slug: 'my-api',
                name: 'My API',
                source_repo_full_name: 'owner/repo',
                source_path: 'api/',
                last_check_at: '2026-02-26T10:00:00Z',
                last_check_status: 'healthy',
                last_check_response_ms: 150,
                last_check_http_code: 200,
                is_active: true,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-02-01T00:00:00Z',
            },
        ];

        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => apiResponse,
        });

        const { result } = renderHook(() => useServices());

        await act(async () => {
            await result.current.fetchServices();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.services).toHaveLength(1);
        expect(result.current.services[0].sourceRepoFullName).toBe('owner/repo');
        expect(result.current.services[0].sourcePath).toBe('api/');
        expect(result.current.services[0].lastCheckAt).toBe('2026-02-26T10:00:00Z');
        expect(result.current.services[0].lastCheckStatus).toBe('healthy');
        expect(result.current.services[0].lastCheckResponseMs).toBe(150);
        expect(result.current.services[0].isActive).toBe(true);
        expect(result.current.error).toBeNull();
        expect(apiFetch).toHaveBeenCalledWith('/api/services');
    });

    it('fetchServices - with filters, appends query params', async () => {
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => [],
        });

        const { result } = renderHook(() => useServices());

        await act(async () => {
            await result.current.fetchServices({ provider: 'gcp', env: 'production' });
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(apiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/services?')
        );
        const calledUrl = apiFetch.mock.calls[0][0];
        expect(calledUrl).toContain('provider=gcp');
        expect(calledUrl).toContain('env=production');
    });

    it('fetchServices - error case, sets error', async () => {
        apiFetch.mockResolvedValue({
            ok: false,
        });

        const { result } = renderHook(() => useServices());

        await act(async () => {
            await result.current.fetchServices();
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Failed to fetch services');
        expect(result.current.services).toEqual([]);
    });

    it('createService - success', async () => {
        const createdService = { slug: 'new-svc', name: 'New Service' };
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => createdService,
        });

        const { result } = renderHook(() => useServices());

        let response;
        await act(async () => {
            response = await result.current.createService({ name: 'New Service', provider: 'gcp' });
        });

        expect(response).toEqual(createdService);
        expect(apiFetch).toHaveBeenCalledWith('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'New Service', provider: 'gcp' }),
        });
    });

    it('createService - error throws', async () => {
        apiFetch.mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'Service already exists' }),
        });

        const { result } = renderHook(() => useServices());

        await expect(
            act(async () => {
                await result.current.createService({ name: 'Dup', provider: 'gcp' });
            })
        ).rejects.toThrow('Service already exists');
    });

    it('updateService - success', async () => {
        const updatedService = { slug: 'my-api', name: 'Updated API' };
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => updatedService,
        });

        const { result } = renderHook(() => useServices());

        let response;
        await act(async () => {
            response = await result.current.updateService('my-api', { name: 'Updated API' });
        });

        expect(response).toEqual(updatedService);
        expect(apiFetch).toHaveBeenCalledWith('/api/services/my-api', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Updated API' }),
        });
    });

    it('deleteService - success', async () => {
        const deleteResponse = { success: true };
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => deleteResponse,
        });

        const { result } = renderHook(() => useServices());

        let response;
        await act(async () => {
            response = await result.current.deleteService('my-api');
        });

        expect(response).toEqual(deleteResponse);
        expect(apiFetch).toHaveBeenCalledWith('/api/services/my-api', { method: 'DELETE' });
    });

    it('checkHealth - success', async () => {
        const healthResult = { status: 'healthy', responseMs: 120 };
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => healthResult,
        });

        const { result } = renderHook(() => useServices());

        let response;
        await act(async () => {
            response = await result.current.checkHealth('my-api');
        });

        expect(response).toEqual(healthResult);
        expect(apiFetch).toHaveBeenCalledWith('/api/services/my-api/health-check', { method: 'POST' });
    });

    it('checkAllHealth - success', async () => {
        const batchResult = { checked: 5, healthy: 4, down: 1 };
        apiFetch.mockResolvedValue({
            ok: true,
            json: async () => batchResult,
        });

        const { result } = renderHook(() => useServices());

        let response;
        await act(async () => {
            response = await result.current.checkAllHealth();
        });

        expect(response).toEqual(batchResult);
        expect(apiFetch).toHaveBeenCalledWith('/api/services/health-check-all', { method: 'POST' });
    });
});
