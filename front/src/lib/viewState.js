// View state of the repos dashboard (tab + filters) and its representation in the URL.
// Only what differs from the default is serialized, so the URL stays short and stable:
// two identical views always produce the same query string.

import { EMPTY_GROUP_FILTER } from './groupFilter';

export const DEFAULT_REPO_FILTERS = {
    search: '',
    status: 'all',
    language: 'all',
    visibility: 'all',
    groups: EMPTY_GROUP_FILTER,
    sort: 'updated',
    hideArchived: true,
    hidePaused: true,
    staleOnly: false,
};

export const DEFAULT_VIEW_STATE = {
    tab: 'default',
    repoFilters: DEFAULT_REPO_FILTERS,
    healthFilter: 'all',
    priorityFilter: 'all',
};

const TABS = ['default', 'testing', 'infrastructure'];
const STATUSES = ['all', 'active', 'inactive', 'abandoned'];
const VISIBILITIES = ['all', 'public', 'private'];
const SORTS = ['updated', 'name', 'stars'];
const HEALTH = ['all', 'unchecked', 'needs-ci', 'needs-tests', 'needs-readme', 'needs-roadmap', 'needs-standards', 'security-alerts', 'unreleased', 'branch-cleanup', 'ci-unreliable', 'config-drift', 'eol-runtime', 'paused', 'deleted'];
const PRIORITIES = ['all', 'high', 'medium', 'low', 'paused', 'none'];

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const list = (value) => (value ? value.split(',').map(v => v.trim()).filter(Boolean) : []);

/** View state -> query string (without "?"). Returns '' for the default view. */
export function serializeViewState({ tab, repoFilters, healthFilter, priorityFilter }) {
    const f = repoFilters;
    const params = new URLSearchParams();
    if (tab !== 'default') params.set('tab', tab);
    if (f.search) params.set('q', f.search);
    if (f.status !== 'all') params.set('status', f.status);
    if (f.language !== 'all') params.set('lang', f.language);
    if (f.visibility !== 'all') params.set('vis', f.visibility);
    if (healthFilter !== 'all') params.set('health', healthFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    if (f.groups.include.length > 0) params.set('groups', [...f.groups.include].sort().join(','));
    if (f.groups.exclude.length > 0) params.set('xgroups', [...f.groups.exclude].sort().join(','));
    if (f.sort !== 'updated') params.set('sort', f.sort);
    if (!f.hideArchived) params.set('archived', '1');
    if (!f.hidePaused) params.set('paused', '1');
    if (f.staleOnly) params.set('stale', '1');
    return params.toString();
}

/** Query string (with or without "?") -> view state. Unknown values fall back to the default. */
export function parseViewState(search = '') {
    const params = new URLSearchParams(search);
    return {
        tab: oneOf(params.get('tab'), TABS, 'default'),
        repoFilters: {
            search: params.get('q') || '',
            status: oneOf(params.get('status'), STATUSES, 'all'),
            language: params.get('lang') || 'all',
            visibility: oneOf(params.get('vis'), VISIBILITIES, 'all'),
            groups: { include: list(params.get('groups')), exclude: list(params.get('xgroups')) },
            sort: oneOf(params.get('sort'), SORTS, 'updated'),
            hideArchived: params.get('archived') !== '1',
            hidePaused: params.get('paused') !== '1',
            staleOnly: params.get('stale') === '1',
        },
        healthFilter: oneOf(params.get('health'), HEALTH, 'all'),
        priorityFilter: oneOf(params.get('priority'), PRIORITIES, 'all'),
    };
}

/** Normalizes a query string by running it through parse + serialize (to compare views). */
export function normalizeViewQuery(search = '') {
    return serializeViewState(parseViewState(search));
}

/** Reads the view state from the current URL. */
export function readViewStateFromUrl() {
    if (typeof window === 'undefined') return DEFAULT_VIEW_STATE;
    return parseViewState(window.location.search);
}

/** Reflects the query in the URL without adding history entries. */
export function writeViewQueryToUrl(query) {
    if (typeof window === 'undefined') return;
    const current = window.location.search.replace(/^\?/, '');
    if (current === query) return;
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
}
