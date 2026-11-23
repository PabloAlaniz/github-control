import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_VIEW_STATE, serializeViewState, parseViewState, normalizeViewQuery,
    readViewStateFromUrl, writeViewQueryToUrl,
} from '@/lib/viewState';

const withFilters = (overrides, rest = {}) => ({
    ...DEFAULT_VIEW_STATE,
    ...rest,
    repoFilters: { ...DEFAULT_VIEW_STATE.repoFilters, ...overrides },
});

describe('viewState', () => {
    describe('serializeViewState', () => {
        it('returns an empty string for the default view', () => {
            expect(serializeViewState(DEFAULT_VIEW_STATE)).toBe('');
        });

        it('only includes values that differ from the default', () => {
            const state = withFilters({ search: 'api', staleOnly: true }, { healthFilter: 'needs-ci' });
            expect(serializeViewState(state)).toBe('q=api&health=needs-ci&stale=1');
        });

        it('encodes hide toggles as "show" flags', () => {
            const state = withFilters({ hideArchived: false, hidePaused: false });
            expect(serializeViewState(state)).toBe('archived=1&paused=1');
        });

        it('sorts group slugs so equal views produce equal queries', () => {
            const a = withFilters({ groups: { include: ['web', 'api'], exclude: ['old'] } });
            const b = withFilters({ groups: { include: ['api', 'web'], exclude: ['old'] } });
            expect(serializeViewState(a)).toBe(serializeViewState(b));
            expect(serializeViewState(a)).toBe('groups=api%2Cweb&xgroups=old');
        });
    });

    describe('parseViewState', () => {
        it('returns the default view for an empty query', () => {
            expect(parseViewState('')).toEqual(DEFAULT_VIEW_STATE);
        });

        it('accepts a leading "?"', () => {
            expect(parseViewState('?tab=testing').tab).toBe('testing');
        });

        it('round-trips a full state', () => {
            const state = {
                tab: 'testing',
                repoFilters: {
                    search: 'c# & co',
                    status: 'inactive',
                    language: 'C++',
                    visibility: 'private',
                    groups: { include: ['api', 'ungrouped'], exclude: ['old'] },
                    sort: 'stars',
                    hideArchived: false,
                    hidePaused: false,
                    staleOnly: true,
                },
                healthFilter: 'needs-tests',
                priorityFilter: 'high',
            };
            expect(parseViewState(serializeViewState(state))).toEqual(state);
        });

        it('falls back to defaults for unknown values', () => {
            const state = parseViewState('tab=nope&status=weird&vis=x&sort=y&health=z&priority=w');
            expect(state).toEqual(DEFAULT_VIEW_STATE);
        });
    });

    describe('normalizeViewQuery', () => {
        it('makes equivalent queries comparable', () => {
            expect(normalizeViewQuery('?stale=1&q=api')).toBe('q=api&stale=1');
            expect(normalizeViewQuery('status=all')).toBe('');
        });
    });

    describe('URL sync', () => {
        beforeEach(() => {
            window.history.replaceState(null, '', '/');
        });

        it('reads the state from the current URL', () => {
            window.history.replaceState(null, '', '/?priority=high');
            expect(readViewStateFromUrl().priorityFilter).toBe('high');
        });

        it('writes the query without adding history entries', () => {
            const before = window.history.length;
            writeViewQueryToUrl('stale=1');
            expect(window.location.search).toBe('?stale=1');
            expect(window.history.length).toBe(before);
        });

        it('clears the query for the default view and keeps the hash', () => {
            window.history.replaceState(null, '', '/?stale=1#top');
            writeViewQueryToUrl('');
            expect(window.location.search).toBe('');
            expect(window.location.hash).toBe('#top');
        });
    });
});
