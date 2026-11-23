import { useState, useMemo } from 'react';
import { EMPTY_GROUP_FILTER, matchesGroupFilter } from '../lib/groupFilter';

const DEFAULT_SERVICE_FILTERS = {
    search: '',
    provider: 'all',
    env: 'all',
    status: 'all',
    language: 'all',
    groups: EMPTY_GROUP_FILTER,
    sort: 'name',
};

export function useServiceFilters({ services, repos }) {
    const [serviceFilters, setServiceFilters] = useState(DEFAULT_SERVICE_FILTERS);

    const serviceLanguages = useMemo(
        () => [...new Set(services.map(s => s.repoLanguage).filter(Boolean))].sort(),
        [services]
    );

    const repoByFullName = useMemo(
        () => new Map(repos.map(r => [r.fullName, r])),
        [repos]
    );

    const filteredServices = useMemo(() => services
        .filter(s => {
            if (serviceFilters.search) {
                const search = serviceFilters.search.toLowerCase();
                if (!s.name.toLowerCase().includes(search) &&
                    !s.slug.toLowerCase().includes(search) &&
                    !s.description?.toLowerCase().includes(search)) {
                    return false;
                }
            }
            if (serviceFilters.provider !== 'all' && s.provider !== serviceFilters.provider) return false;
            if (serviceFilters.env !== 'all' && s.env !== serviceFilters.env) return false;
            if (serviceFilters.status !== 'all' && (s.lastCheckStatus || 'unknown') !== serviceFilters.status) return false;
            if (serviceFilters.language !== 'all') {
                if ((s.repoLanguage || null) !== serviceFilters.language) return false;
            }
            const linkedSlugs = repoByFullName.get(s.sourceRepoFullName)?.groups || [];
            if (!matchesGroupFilter(serviceFilters.groups, linkedSlugs)) return false;
            return true;
        })
        .sort((a, b) => {
            switch (serviceFilters.sort) {
                case 'name': return a.name.localeCompare(b.name);
                case 'provider': return a.provider.localeCompare(b.provider);
                case 'status': return (a.lastCheckStatus || 'unknown').localeCompare(b.lastCheckStatus || 'unknown');
                case 'responseMs': return (a.lastCheckResponseMs ?? 99999) - (b.lastCheckResponseMs ?? 99999);
                default: return 0;
            }
        }), [services, serviceFilters, repoByFullName]);

    return {
        serviceFilters,
        setServiceFilters,
        filteredServices,
        serviceLanguages,
    };
}
