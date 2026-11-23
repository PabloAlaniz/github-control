import { useState, useCallback } from 'react';
import { apiFetch } from '../lib/api';

function mapService(s) {
    return {
        ...s,
        sourceRepoFullName: s.source_repo_full_name ?? s.sourceRepoFullName,
        sourcePath: s.source_path ?? s.sourcePath,
        lastCheckAt: s.last_check_at ?? s.lastCheckAt,
        lastCheckStatus: s.last_check_status ?? s.lastCheckStatus,
        lastCheckResponseMs: s.last_check_response_ms ?? s.lastCheckResponseMs,
        lastCheckHttpCode: s.last_check_http_code ?? s.lastCheckHttpCode,
        isActive: s.is_active ?? s.isActive,
        createdAt: s.created_at ?? s.createdAt,
        updatedAt: s.updated_at ?? s.updatedAt,
        repoLanguage: s.repo_language ?? s.repoLanguage,
        repoStack: s.repo_stack ?? s.repoStack,
    };
}

export function useServices() {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchServices = useCallback(async (filters = {}) => {
        try {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams();
            if (filters.provider) params.set('provider', filters.provider);
            if (filters.env) params.set('env', filters.env);
            if (filters.source_repo) params.set('source_repo', filters.source_repo);
            const qs = params.toString();
            const res = await apiFetch(`/api/services${qs ? `?${qs}` : ''}`);
            if (!res.ok) throw new Error('Failed to fetch services');
            const data = await res.json();
            setServices(data.map(mapService));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const createService = useCallback(async (serviceData) => {
        const res = await apiFetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serviceData),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to create service');
        }
        return res.json();
    }, []);

    const updateService = useCallback(async (slug, serviceData) => {
        const res = await apiFetch(`/api/services/${slug}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serviceData),
        });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to update service');
        }
        return res.json();
    }, []);

    const deleteService = useCallback(async (slug) => {
        const res = await apiFetch(`/api/services/${slug}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to delete service');
        }
        return res.json();
    }, []);

    const checkHealth = useCallback(async (slug) => {
        const res = await apiFetch(`/api/services/${slug}/health-check`, { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Health check failed');
        }
        return res.json();
    }, []);

    const checkAllHealth = useCallback(async () => {
        const res = await apiFetch('/api/services/health-check-all', { method: 'POST' });
        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Batch health check failed');
        }
        return res.json();
    }, []);

    return {
        services,
        loading,
        error,
        fetchServices,
        createService,
        updateService,
        deleteService,
        checkHealth,
        checkAllHealth,
    };
}
