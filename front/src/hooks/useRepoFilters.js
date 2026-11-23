import { useState, useMemo, useCallback } from 'react';
import { isStale } from '../lib/formatters';
import { matchesGroupFilter } from '../lib/groupFilter';
import { readViewStateFromUrl } from '../lib/viewState';

export function useRepoFilters(repos, initialState) {
    // The initial state comes from the URL: a link with filters opens the view already filtered.
    const [initial] = useState(() => initialState || readViewStateFromUrl());
    const [repoFilters, setRepoFilters] = useState(initial.repoFilters);
    const [healthFilter, setHealthFilter] = useState(initial.healthFilter);
    const [priorityFilter, setPriorityFilter] = useState(initial.priorityFilter);

    /** Replaces all filters at once (saved view or reset). */
    const applyFilters = useCallback((state) => {
        setRepoFilters(state.repoFilters);
        setHealthFilter(state.healthFilter);
        setPriorityFilter(state.priorityFilter);
    }, []);

    const baseRepos = useMemo(() => repos.filter(r => {
        if (repoFilters.hideArchived && r.isArchived) return false;
        if (repoFilters.hidePaused && r.priority === 'paused' && healthFilter !== 'paused') return false;
        return true;
    }), [repos, repoFilters.hideArchived, repoFilters.hidePaused, healthFilter]);

    const filteredRepos = useMemo(() => baseRepos
        .filter(repo => {
            if (repoFilters.search) {
                const search = repoFilters.search.toLowerCase();
                if (!repo.name.toLowerCase().includes(search) &&
                    !repo.description?.toLowerCase().includes(search)) {
                    return false;
                }
            }
            if (repoFilters.status !== 'all' && repo.activityStatus !== repoFilters.status) return false;
            if (repoFilters.language !== 'all' && repo.language !== repoFilters.language) return false;
            if (repoFilters.visibility === 'public' && repo.isPrivate) return false;
            if (repoFilters.visibility === 'private' && !repo.isPrivate) return false;
            if (!matchesGroupFilter(repoFilters.groups, repo.groups)) return false;
            if (repoFilters.staleOnly && !isStale(repo)) return false;
            return true;
        })
        .sort((a, b) => {
            switch (repoFilters.sort) {
                case 'updated': return new Date(b.pushedAt) - new Date(a.pushedAt);
                case 'name': return a.name.localeCompare(b.name);
                case 'stars': return b.stargazersCount - a.stargazersCount;
                default: return 0;
            }
        }), [baseRepos, repoFilters]);

    const languages = useMemo(
        () => [...new Set(repos.map(r => r.language).filter(Boolean))].sort(),
        [repos]
    );

    const uncheckedHealthCount = useMemo(
        () => repos.filter(r => r.hasCi === null && r.hasTests === null && r.hasReadme === null).length,
        [repos]
    );

    return {
        repoFilters,
        setRepoFilters,
        healthFilter,
        setHealthFilter,
        priorityFilter,
        setPriorityFilter,
        applyFilters,
        baseRepos,
        filteredRepos,
        languages,
        uncheckedHealthCount,
    };
}
